"""Actual artifact-schema and byte-preservation contracts; run in worker image."""
import contextlib
import io
import json
import os
import pathlib
import runpy
import tempfile
import unittest
import base64

run_checks = runpy.run_path(str(pathlib.Path(__file__).parent.parent / "judge-harness.py"))["run_checks"]

class ArtifactSchemaTests(unittest.TestCase):
    def test_schema_and_failures(self):
        schema = {"type": "object", "required": ["reviews"], "additionalProperties": False, "properties": {"reviews": {"type": "array", "minItems": 1, "maxItems": 1, "items": {"type": "object", "required": ["id", "decision", "findings"], "properties": {"id": {"type": "string"}, "decision": {"enum": ["PASS", "FAIL"]}, "findings": {"type": "array", "items": {"type": "object", "required": ["source_id", "reason"], "properties": {"source_id": {"type": "string"}, "reason": {"type": "string", "minLength": 1}}}}}}}}}
        valid = {"reviews": [{"id": "one", "decision": "FAIL", "findings": [{"source_id": "missing", "reason": "insufficient evidence"}]}]}
        previous = os.getcwd()
        with tempfile.TemporaryDirectory() as root:
            os.chdir(root)
            try:
                def grade(output, definition=schema):
                    pathlib.Path("review.json").write_text(json.dumps(output))
                    spec = {"assertions": [{"id": "STRUCTURE", "dimension": "output"}], "checks": [{"assertionId": "STRUCTURE", "dimension": "output", "kind": "json_schema", "file": "review.json", "format": "json", "value": json.dumps(definition)}]}
                    stream = io.StringIO()
                    with contextlib.redirect_stdout(stream):
                        code = run_checks(spec)
                    return code, json.loads(stream.getvalue())
                self.assertEqual(grade(valid)[0], 0)
                for output in [{}, {"reviews": []}, {"reviews": valid["reviews"] * 2}, {"reviews": [{"id": "one", "decision": "PASS", "findings": [{"source_id": "F2", "reason": 7}]}]}, {"reviews": valid["reviews"], "extra": True}]:
                    code, envelope = grade(output)
                    self.assertEqual(code, 1)
                    self.assertIsNone(envelope["error"])
                    self.assertFalse(envelope["assertions"][0]["passed"])
                for invalid in [{"type": "not-a-type"}, {"$ref": "file:///unavailable"}, {"$ref": "https://example.invalid/schema"}, {"type": "string", "format": "email"}]:
                    code, envelope = grade(valid, invalid)
                    self.assertEqual(code, 2)
                    self.assertEqual(envelope["error"]["code"], "VALIDATOR_ERROR")
                pathlib.Path("input.json").write_text('{ "value": 1 }')
                stream = io.StringIO()
                with contextlib.redirect_stdout(stream):
                    code = run_checks({"assertions": [{"id": "BYTES", "dimension": "inputs"}], "checks": [{"assertionId": "BYTES", "dimension": "inputs", "kind": "unchanged", "file": "input.json", "format": "text", "expectedMaterialId": "original", "allowedPaths": []}], "truth": {"original": base64.b64encode(b'{"value":1}').decode()}})
                self.assertEqual(code, 1, "Equivalent JSON with changed bytes is still a preservation failure")
            finally:
                os.chdir(previous)

if __name__ == "__main__":
    unittest.main()
