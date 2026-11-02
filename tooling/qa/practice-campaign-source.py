"""Read-only OOXML audit of NEXUS practice identities, layouts and modes.

Document prose is evidence, never executable instructions. No office application
or desktop document is opened or modified. A small portable fixture lets CI
compare the declared catalogue with these independently read source tables.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import zipfile

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
ROOT = Path(__file__).resolve().parents[2]


def text(node):
    return "".join(t.text or "" for t in node.findall(".//w:t", NS)).strip()


def clean(value):
    return re.sub(r"\s+", " ", value).strip()


def load_docx(file):
    raw = Path(file).read_bytes()
    with zipfile.ZipFile(file) as archive:
        body = ET.fromstring(archive.read("word/document.xml")).find("w:body", NS)
        blocks = []
        for node in body:
            if node.tag == "{%s}p" % NS["w"]:
                blocks.append({"type": "p", "text": text(node)})
            elif node.tag == "{%s}tbl" % NS["w"]:
                rows = [[text(cell) for cell in row.findall("w:tc", NS)]
                        for row in node.findall("w:tr", NS)]
                blocks.append({"type": "table", "rows": rows})
    return {"filename": Path(file).name, "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw), "blocks": blocks}


def number(value):
    return float(value.strip().replace(",", "."))


def read_practices(source):
    blocks = source["blocks"]
    heads = [(i, re.match(r"^([LI]\d{2})\s*·\s*(.+)$", b.get("text", "")))
             for i, b in enumerate(blocks) if b["type"] == "p"]
    heads = [(i, m) for i, m in heads if m and not m.group(2).startswith(
        ("Layout y diagrama", "Casos y prompt"))]
    result = []
    for n, (i, match) in enumerate(heads):
        section = blocks[i:heads[n+1][0] if n+1 < len(heads) else len(blocks)]
        tables = [b["rows"] for b in section if b["type"] == "table"]
        table = lambda header: next(t for t in tables if t and t[0] and t[0][0] == header)
        layout = table("ID")
        modes = table("Modo")
        steps = table("Etapa")
        cases = table("Caso")
        elements = []
        for row in layout[1:]:
            coordinate = re.search(r"\(\s*([-\d.,]+)\s*;\s*([-\d.,]+)\s*\)", row[2])
            assert coordinate, (match.group(1), row)
            dims = [number(v) for v in row[3].split("×")]
            assert len(dims) == 3
            elements.append({"id": row[0], "name": clean(row[1]),
                             "x": number(coordinate.group(1)), "z": number(coordinate.group(2)),
                             "width": dims[0], "depth": dims[1], "height": dims[2]})
        area_text = next(b["text"] for b in section if b["type"] == "p" and
                         b["text"].startswith("Área local propuesta:"))
        area = re.search(r"Área local propuesta:\s*([\d.,]+)\s*×\s*([\d.,]+)\s*m", area_text)
        result.append({"id": match.group(1), "title": clean(match.group(2)),
                       "track": "cedi" if match.group(1).startswith("L") else "smart-factory",
                       "area": {"width": number(area.group(1)), "depth": number(area.group(2))},
                       "elements": elements,
                       "modes": [{"name": clean(r[0]), "variants": clean(r[1]), "actions": clean(r[2])} for r in modes[1:]],
                       "steps": [{"title": clean(r[0]), "action": clean(r[1]), "evidence": clean(r[2])} for r in steps[1:]],
                       "cases": [{"name": clean(r[0]), "condition": clean(r[1]), "achievement": clean(r[2])} for r in cases[1:]]})
    assert len(result) == 64 and len({r["id"] for r in result}) == 64
    assert [r["id"] for r in result] == [f"{p}{i:02d}" for p in ("L", "I") for i in range(1, 33)]
    assert all(len(r["modes"]) == 3 and len(r["steps"]) == 6 and len(r["cases"]) == 3 for r in result)
    return result


def audit(practices, equipment):
    declared = json.loads((ROOT / "modules/logistica-industrial/practices/data/source-practices.json").read_text(encoding="utf-8"))
    index = json.loads((ROOT / "modules/logistica-industrial/practices/data/practice-index-data.json").read_text(encoding="utf-8"))
    for collection in (declared["records"], index["entries"]):
        assert len(collection) == 64
        for expected in practices:
            actual = next(r for r in collection if r["id"] == expected["id"])
            assert clean(actual["title"]) == expected["title"]
            assert actual["layout"]["area"] == expected["area"]
            assert len(actual["layout"]["elements"]) == len(expected["elements"])
            for e, a in zip(expected["elements"], actual["layout"]["elements"]):
                assert e == {"id": a["id"], "name": clean(a["name"]), "x": a["origin2d"]["x"],
                             "z": a["origin2d"]["y"], **a["dimensions"]}, (expected["id"], e)
            assert [clean(m["name"]) for m in actual["modes"]] == [m["name"] for m in expected["modes"]]
    heads = [b["text"] for b in equipment["blocks"] if b["type"] == "p" and
             re.match(r"^[A-Z]{2}-\d{2}\s+", b["text"])]
    assert len(heads) == 189
    return {"practiceCount": len(practices), "equipmentCount": len(heads),
            "layoutElements": sum(len(r["elements"]) for r in practices),
            "steps": sum(len(r["steps"]) for r in practices), "modes": sorted({m["name"] for r in practices for m in r["modes"]})}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--practices", required=True)
    parser.add_argument("--equipment", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    p, e = load_docx(args.practices), load_docx(args.equipment)
    records = read_practices(p)
    report = {"format": "smarttwin.independent-practice-campaign-source", "version": 1,
              "sourceInstructionsAreData": True,
              "sources": [{k: s[k] for k in ("filename", "sha256", "bytes")} for s in (p, e)],
              "counts": audit(records, e), "practices": records}
    Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": True, **report["counts"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
