import base64
import csv
import io
import json
import os
import pathlib
import sys


def document(data, format):
    if format == "json":
        return json.loads(data)
    if format == "csv":
        return list(csv.DictReader(io.StringIO(data.decode("utf-8-sig"))))
    if format == "xlsx":
        import openpyxl
        book = openpyxl.load_workbook(io.BytesIO(data), data_only=False)
        return {sheet.title: {cell.coordinate: cell.value for row in sheet for cell in row if cell.value is not None} for sheet in book}
    return data.decode("utf-8")


def select(value, pointer):
    if not pointer:
        return value
    if not pointer.startswith("/"):
        raise ValueError("Selectors must be JSON pointers")
    for key in pointer[1:].split("/"):
        key = key.replace("~1", "/").replace("~0", "~")
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


def flatten(value, prefix=""):
    if isinstance(value, (dict, list)) and not value:
        return {prefix: value}
    if isinstance(value, dict):
        return {k: v for key, item in value.items() for k, v in flatten(item, prefix + "/" + str(key).replace("~", "~0").replace("/", "~1")).items()}
    if isinstance(value, list):
        return {k: v for i, item in enumerate(value) for k, v in flatten(item, prefix + "/" + str(i)).items()}
    return {prefix: value}


def run_checks(spec):
    grouped = {a["id"]: [] for a in spec["assertions"]}
    envelope = {"schemaVersion": "skilled-grading-v1", "assertions": [], "error": None}
    try:
        for check in spec["checks"]:
            matches = [a for a in spec["assertions"] if a["id"] == check["assertionId"]] if check.get("assertionId") else [a for a in spec["assertions"] if a["dimension"] == check.get("dimension", "correctness")]
            if len(matches) != 1:
                raise ValueError("Validator requires one explicit assertion ID")
            definition = matches[0]
            if check.get("file"):
                root = pathlib.Path.cwd().resolve()
                path = (root / check["file"]).resolve()
                if root not in path.parents:
                    raise ValueError("Artifact path escapes case workspace")
                if not path.is_file():
                    grouped[definition["id"]].append((False, "Required artifact is missing: " + check["file"]))
                    continue
                if path.stat().st_size > 100 * 1024 * 1024:
                    raise ValueError("Artifact exceeds 100 MiB")
                try:
                    actual = document(path.read_bytes(), check.get("format", "text"))
                except (ValueError, UnicodeError, OSError) as error:
                    grouped[definition["id"]].append((False, "Invalid output artifact: " + str(error)))
                    continue
            else:
                actual = os.environ.get("EVAL_FINAL_MESSAGE", "")
            kind = check["kind"]
            if kind == "unchanged":
                expected = document(base64.b64decode(spec["truth"][check["expectedMaterialId"]]), check.get("format", "text"))
                left, right = flatten(expected), flatten(actual)
                allowed = set(check.get("allowedPaths", []))
                keys = (set(left) | set(right)) - allowed
                passed = all(left.get(key) == right.get(key) and isinstance(left.get(key), bool) == isinstance(right.get(key), bool) and (key in left) == (key in right) for key in keys)
            else:
                try:
                    actual = select(actual, check.get("selector", ""))
                except (KeyError, IndexError):
                    grouped[definition["id"]].append((False, "Required output field is missing"))
                    continue
                expected = check.get("value")
                if kind == "equals":
                    passed = actual == expected and isinstance(actual, bool) == isinstance(expected, bool)
                elif kind == "contains":
                    passed = expected in actual
                elif kind == "not_contains":
                    passed = expected not in actual
                else:
                    raise ValueError("Unknown deterministic check")
            observation = {"protected": kind == "unchanged", "format": check.get("format", "text"), "allowedPaths": check.get("allowedPaths", []), "file": check.get("file", "final message"), "selector": check.get("selector", ""), "expected": json.dumps(expected, ensure_ascii=False)[:2000], "actual": json.dumps(actual, ensure_ascii=False)[:2000]}
            grouped[definition["id"]].append((passed, kind + " check " + ("passed" if passed else "failed"), observation))
        for definition in spec["assertions"]:
            checks = grouped[definition["id"]]
            if not checks:
                raise ValueError("Required assertion has no concrete validator: " + definition["id"])
            envelope["assertions"].append({"id": definition["id"], "passed": all(c[0] for c in checks), "evidence": "; ".join(c[1] for c in checks), "observations": [c[2] for c in checks if len(c) > 2]})
    except Exception as error:
        envelope["error"] = {"code": "VALIDATOR_ERROR", "detail": str(error)}
    print(json.dumps(envelope, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 2 if envelope["error"] else (0 if all(a["passed"] for a in envelope["assertions"]) else 1)
