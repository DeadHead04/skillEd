"""Credential-free workbook acceptance; run in the pinned executor image."""
import base64
import contextlib
import importlib.util
import io
import json
import os
import pathlib
import tempfile
import unittest

import openpyxl

module = importlib.util.spec_from_file_location("judge", pathlib.Path(__file__).parent.parent / "judge-harness.py")
judge = importlib.util.module_from_spec(module)
module.loader.exec_module(judge)

class WorkbookContract(unittest.TestCase):
    def test_protected_cells_and_output_integrity(self):
        with tempfile.TemporaryDirectory() as root:
            original_cwd = os.getcwd()
            try:
                os.chdir(root)
                book = openpyxl.Workbook()
                book.active.title = "Data"
                book.active["A1"] = "old"
                book.active["B1"] = 42
                book.save("original.xlsx")
                spec = {
                    "assertions": [{"id": "correct", "dimension": "correctness"}, {"id": "protected", "dimension": "scope"}],
                    "truth": {"original": base64.b64encode(pathlib.Path("original.xlsx").read_bytes()).decode()},
                    "checks": [
                        {"kind": "equals", "file": "output.xlsx", "format": "xlsx", "selector": "/Data/A1", "value": "new", "dimension": "correctness"},
                        {"kind": "unchanged", "file": "output.xlsx", "format": "xlsx", "expectedMaterialId": "original", "allowedPaths": ["/Data/A1"], "dimension": "scope"},
                    ],
                }
                def grade():
                    stream = io.StringIO()
                    with contextlib.redirect_stdout(stream):
                        judge.run_checks(spec)
                    return json.loads(stream.getvalue())
                book.active["A1"] = "new"
                book.save("output.xlsx")
                self.assertEqual([a["passed"] for a in grade()["assertions"]], [True, True])
                book.active["B1"] = 43
                book.save("output.xlsx")
                self.assertEqual([a["passed"] for a in grade()["assertions"]], [True, False])
                pathlib.Path("output.xlsx").unlink()
                missing = grade()
                self.assertIsNone(missing["error"])
                self.assertFalse(missing["assertions"][0]["passed"])
            finally:
                os.chdir(original_cwd)

if __name__ == "__main__":
    unittest.main()
