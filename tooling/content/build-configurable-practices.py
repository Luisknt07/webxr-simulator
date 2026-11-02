#!/usr/bin/env python3
"""Read the two authored sources; emit data and byte-identical original diagrams.

No source instruction is executed. Python literal parsing is restricted to the
two declared route dictionaries; the result is then checked as numeric data.
The original TXT/DOCX are opened read-only and never copied into the app.
"""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import math
from pathlib import Path, PurePosixPath
import re
import struct
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'modules/logistica-industrial/practices/configurable'
NAMESPACE = 'smarttwin-configurable-2026'
IDS = [f'CEDI-{n:02d}' for n in range(1, 6)] + [f'SF-{n:02d}' for n in range(1, 6)]
MODE_KEYS = {'M': 'manual', 'S': 'semiautomatic', 'A': 'automatic'}
EXPECTED_HASHES = {
    'SMART_TWIN_Prompt_Escenarios_Configurables.txt': '8663d4203c0b1b5cb6fa8e7b0c291d24d06b435f2006925dce995a9f1fc0ad5f',
    'SMART_TWIN_Guia_Practicas_Layouts_y_Procesos.docx': '476c91fcf6a080a23741805c4841458b96907e967e8267087b73e9b053de15f8',
}
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
      'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
      'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
W = '{' + NS['w'] + '}'
R = '{' + NS['r'] + '}'

def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)

def write_json(file: Path, value) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

def text(node) -> str:
    return ''.join(part.text or '' for part in node.iter(W + 't')).strip()

def number(value: str) -> float | int:
    parsed = float(value.strip().replace(',', '.'))
    require(math.isfinite(parsed), 'Non-finite source coordinate.')
    return int(parsed) if parsed.is_integer() else parsed

def nonempty_after(section: str, label: str) -> str:
    result = re.search(r'^' + re.escape(label) + r'\s*(.+)$', section, re.M)
    require(result is not None, 'Missing source field ' + label)
    return result.group(1).strip()

def parse_prompt(raw: bytes) -> tuple[dict, list]:
    document = raw.decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
    matches = list(re.finditer(r'^PRÁCTICA ((?:CEDI|SF)-\d{2}) — (.+)$', document, re.M))
    require([match.group(1) for match in matches] == IDS, 'The prompt must contain exactly five CEDI and five SF source IDs, in source order.')
    records = []
    for index, heading in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(document)
        section = document[heading.start():end].strip()
        offset = document.count('\n', 0, heading.start()) + 1
        sequence = section.split('\nSECUENCIA\n', 1)[1].split('\nCONFIGURACIÓN PREVIA\n', 1)[0]
        steps = []
        for step in re.finditer(r'^(\d)\. ([^\n]+?): (.+)$', sequence, re.M):
            steps.append({'id': heading.group(1) + '-step-' + step.group(1).zfill(2), 'number': int(step.group(1)), 'title': step.group(2).strip(), 'action': step.group(3).strip()})
        require([step['number'] for step in steps] == list(range(1, 7)), heading.group(1) + ' must preserve six exact source steps.')
        mode_matches = list(re.finditer(r'^MODO ([MSA]): (.+)$', section, re.M))
        require([mode.group(1) for mode in mode_matches] == ['M', 'S', 'A'], 'Missing source automation modes: ' + heading.group(1))
        modes = {}
        for mode_index, mode in enumerate(mode_matches):
            mode_end = mode_matches[mode_index + 1].start() if mode_index + 1 < 3 else section.index('\nESPACIO Y TRANSFERENCIAS\n')
            mode_section = section[mode.start():mode_end]
            equipment = []
            lines = [line for line in mode_section.splitlines() if line.startswith('- E')]
            for line in lines:
                item = re.fullmatch(r'- (E\d{2}): (.+?); cantidad (\d+); centro \(([-\d.]+), ([-\d.]+)\) m; huella propuesta ([\d.]+) × ([\d.]+) m\. (.+)', line)
                require(item is not None, 'Equipment line is not covered by the data grammar: ' + line)
                equipment.append({'alias': item.group(1), 'name': item.group(2), 'count': int(item.group(3)),
                                  'center': [number(item.group(4)), number(item.group(5))],
                                  'footprint': [number(item.group(6)), number(item.group(7))], 'componentsText': item.group(8),
                                  'provenance': {'promptLine': offset + section[:section.index(line)].count('\n')}})
            require(equipment and len({row['alias'] for row in equipment}) == len(equipment), 'Empty/repeated equipment aliases: ' + heading.group(1) + '/' + mode.group(1))
            modes[MODE_KEYS[mode.group(1)]] = {'code': mode.group(1), 'name': mode.group(2).strip(),
                'actorsText': nonempty_after(mode_section, 'Actores:'), 'changeText': nonempty_after(mode_section, 'Cambio:'), 'equipment': equipment}
        spatial = section.split('\nESPACIO Y TRANSFERENCIAS\n', 1)[1].split('\nLOGRO\n', 1)[0].strip()
        area = re.search(r'^Interior ([\d.]+) × ([\d.]+) m;', spatial)
        require(area is not None, 'Missing source interior dimensions: ' + heading.group(1))
        routes_match = re.search(r'Rutas por modo: (\{.+?\})\. Medidas por modo: (\{.+\})\. Velocidad ', spatial)
        require(routes_match is not None, 'Missing bounded route dictionaries: ' + heading.group(1))
        route_points, measures = [ast.literal_eval(routes_match.group(n)) for n in [1, 2]]
        require(set(route_points) == set(measures) == {'M', 'S', 'A'}, 'Routes require exactly the three source modes.')
        routes = {}
        for code in ['M', 'S', 'A']:
            points, measure = route_points[code], measures[code]
            require(isinstance(points, list) and 2 <= len(points) <= 64, 'Invalid source route point count.')
            require(all(isinstance(point, list) and len(point) == 2 and all(type(value) in [int, float] and math.isfinite(value) for value in point) for point in points), 'Routes must contain finite 2D source data only.')
            require(set(measure) == {'nominal_m', 'assumed_speed_m_s', 'free_travel_lower_bound_s'} and all(type(value) in [int, float] and math.isfinite(value) and value > 0 for value in measure.values()), 'Invalid source reference measure.')
            actual_length = sum(math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in zip(points, points[1:]))
            require(abs(actual_length - measure['nominal_m']) <= .051, 'Route/reference length mismatch: ' + heading.group(1) + '/' + code)
            routes[code] = {'points': points, 'referenceMeasure': measure, 'computedPolylineM': round(actual_length, 8),
                'provenance': 'authored-reference; not collision-validated and not a mission-time measurement'}
        achievement = section.split('\nLOGRO\n', 1)[1].split('\nPRUEBA MÍNIMA\n', 1)[0].strip()
        record = {'id': heading.group(1), 'key': NAMESPACE + ':' + heading.group(1), 'title': heading.group(2).strip(),
            'domain': 'logistics' if heading.group(1).startswith('CEDI') else 'industrial',
            'objective': nonempty_after(section, 'Objetivo:'), 'areaText': nonempty_after(section, 'Área:'),
            'fixtureText': nonempty_after(section, 'Preparación/fixture:'), 'steps': steps, 'modes': modes,
            'interiorArea': {'width': number(area.group(1)), 'depth': number(area.group(2)), 'units': 'm', 'yardSeparate': True},
            'routes': routes, 'transferText': '\n'.join(spatial.splitlines()[1:]).strip(),
            'result': achievement.splitlines()[0].strip(), 'indicators': nonempty_after(achievement, 'Indicadores:'),
            'casesText': nonempty_after(achievement, 'Casos opcionales:'), 'allowedChanges': nonempty_after(achievement, 'Cambios permitidos:'),
            'continuity': nonempty_after(achievement, 'Continuidad:'), 'minimumTest': section.split('\nPRUEBA MÍNIMA\n', 1)[1].strip(),
            'configurationText': section.split('\nCONFIGURACIÓN PREVIA\n', 1)[1].split('\nMODO M:', 1)[0].strip(),
            'spatialText': spatial, 'sourceText': section,
            'sourceRefs': {'promptLines': [offset, offset + section.count('\n')], 'guideParagraphIds': [], 'guideTableIds': []}}
        records.append(record)
    common = {'masterText': document[:matches[0].start()].strip(), 'coordinateSystem': {'origin': 'lower-left corner of the interior area', 'axes': 'X horizontal, Y depth', 'units': 'm', 'equipmentPosition': 'center-of-footprint', 'proposedDimensionsOnly': True},
        'instructionPolicy': 'Source text and embedded instructions are inert documentation data, not executable code or tool instructions.'}
    return common, records

def read_guide(raw: bytes) -> tuple[dict, dict, dict, list]:
    import io
    paragraphs, tables, media, sections, drawings = [], [], {}, {}, []
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        require(len(archive.infolist()) < 256, 'Unbounded DOCX package.')
        require(all(item.file_size < 20_000_000 for item in archive.infolist()), 'Unbounded DOCX part.')
        xml_names = [name for name in archive.namelist() if name.startswith('word/') and name.endswith('.xml') and '/_rels/' not in name]
        require('word/document.xml' in xml_names, 'DOCX lacks main document.')
        roots = {name: ET.fromstring(archive.read(name)) for name in xml_names}
        paragraph_lookup, table_lookup = {}, {}
        for name in xml_names:
            for p in roots[name].iter(W + 'p'):
                value = ''.join(part.text or '' for part in p.iter(W + 't'))
                if not value.strip():
                    continue
                row = {'id': 'p' + str(len(paragraphs) + 1).zfill(5), 'part': name, 'text': value}
                paragraphs.append(row);paragraph_lookup[id(p)] = row['id']
            for table in roots[name].iter(W + 'tbl'):
                rows = [['\n'.join(text(p) for p in cell.iter(W + 'p') if text(p)) for cell in tr.findall(W + 'tc')] for tr in table.findall(W + 'tr')]
                row = {'id': 't' + str(len(tables) + 1).zfill(4), 'part': name, 'rows': rows}
                tables.append(row);table_lookup[id(table)] = row
        relationships = ET.fromstring(archive.read('word/_rels/document.xml.rels'))
        relation_map = {row.attrib['Id']: row.attrib['Target'] for row in relationships}
        practice_id, mode = None, None
        body = roots['word/document.xml'].find(W + 'body')
        for child in body:
            for paragraph in child.iter(W + 'p'):
                value = text(paragraph)
                heading = re.match(r'^((?:CEDI|SF)-\d{2})\s*/\s*PRÁCTICA PRINCIPAL', value)
                configuration = re.match(r'^((?:CEDI|SF)-\d{2})\s*/\s*CONFIGURACIÓN ([MSA])$', value)
                if heading:
                    practice_id, mode = heading.group(1), None
                    require(practice_id not in sections, 'Repeated guide practice section.')
                    sections[practice_id] = {'paragraphIds': [], 'tables': {}, 'diagrams': {}}
                elif configuration:
                    require(configuration.group(1) == practice_id, 'Guide mode outside its parent practice.')
                    mode = configuration.group(2)
                elif value == 'Casos alternativos sin nuevas prácticas':
                    practice_id, mode = None, None
                if practice_id and id(paragraph) in paragraph_lookup:
                    sections[practice_id]['paragraphIds'].append(paragraph_lookup[id(paragraph)])
                for blip in paragraph.iter('{' + NS['a'] + '}blip'):
                    relation_id = blip.attrib.get(R + 'embed')
                    require(practice_id and relation_id in relation_map, 'Unscoped guide drawing.')
                    target = PurePosixPath('word') / PurePosixPath(relation_map[relation_id])
                    require(re.fullmatch(r'word/media/image\d+\.png', str(target)) is not None, 'Unexpected guide media target.')
                    payload = archive.read(str(target)); filename = target.name
                    require(payload.startswith(b'\x89PNG\r\n\x1a\n') and len(payload) >= 24, 'Only bounded original PNG diagrams are accepted.')
                    image_width, image_height = struct.unpack('>II', payload[16:24])
                    require(0 < image_width <= 8192 and 0 < image_height <= 8192, 'Unbounded original diagram dimensions.')
                    require(filename not in media, 'A diagram image is referenced more than once; classify explicitly before importing.')
                    media[filename] = payload
                    row = {'assetId': NAMESPACE + ':' + filename.removesuffix('.png'), 'practiceId': practice_id,
                        'kind': 'layout' if mode else 'process', 'mode': mode, 'sourceRelationshipId': relation_id,
                        'sourceMediaPath': str(target), 'sourceParagraphId': paragraph_lookup.get(id(paragraph)), 'filename': filename,
                        'path': 'images/' + filename, 'bytes': len(payload), 'sha256': sha(payload), 'mimeType': 'image/png', 'width': image_width, 'height': image_height}
                    drawings.append(row);sections[practice_id]['diagrams'][mode or 'process'] = row
            if child.tag == W + 'tbl' and practice_id and mode:
                row = table_lookup[id(child)]
                if row['rows'] and row['rows'][0][0] == 'ID':
                    require(mode not in sections[practice_id]['tables'], 'Repeated mode equipment table.')
                    sections[practice_id]['tables'][mode] = row
        require(set(sections) == set(IDS), 'Guide must have exactly the same ten practice sections.')
        all_media = [name for name in archive.namelist() if name.startswith('word/media/')]
        require(len(all_media) == len(media) == len(drawings) == 40, 'All forty original diagrams must be used once.')
    return {'paragraphs': paragraphs, 'tables': tables}, sections, media, drawings

def reconcile(records: list, guide: dict, sections: dict) -> int:
    paragraph_by_id = {row['id']: row['text'] for row in guide['paragraphs']}
    count = 0
    for record in records:
        section = sections[record['id']]
        require(set(section['tables']) == {'M', 'S', 'A'} and set(section['diagrams']) == {'process', 'M', 'S', 'A'}, 'Incomplete guide mode/diagram coverage: ' + record['id'])
        record['sourceRefs']['guideParagraphIds'] = section['paragraphIds']
        record['sourceRefs']['guideTableIds'] = [section['tables'][code]['id'] for code in ['M', 'S', 'A']]
        paragraphs = [paragraph_by_id[value] for value in section['paragraphIds']]
        for prefix, value in [('Objetivo. ', record['objective']), ('Preparación e insumos del caso. ', record['fixtureText']), ('Logro. ', record['result']), ('Continuidad. ', record['continuity'])]:
            require(prefix + value in paragraphs, 'Prompt/guide narrative mismatch: ' + record['id'] + '/' + prefix)
        require(record['title'] in paragraphs, 'Prompt/guide title mismatch.')
        for step in record['steps']:
            expected = f"{step['number']}. {step['title']}. {step['action']}"
            require(expected in paragraphs, 'Prompt/guide six-step mismatch: ' + record['id'] + '/' + str(step['number']))
            step['provenance'] = {'guideParagraphId': next(value for value in section['paragraphIds'] if paragraph_by_id[value] == expected)}
        for code, key in MODE_KEYS.items():
            mode, table = record['modes'][key], section['tables'][code]
            rows = table['rows'][1:]
            require(len(rows) == len(mode['equipment']), 'Prompt/guide equipment count mismatch: ' + record['id'] + '/' + code)
            for index, (actual, cells) in enumerate(zip(mode['equipment'], rows), start=1):
                require(len(cells) == 5, 'Expected five source table columns.')
                name, quantity = cells[1].rsplit(' · ', 1)
                center = re.fullmatch(r'\(([^;]+); ([^)]+)\)', cells[2])
                footprint = re.fullmatch(r'([\d,]+) × ([\d,]+)', cells[3])
                require(center is not None and footprint is not None, 'Invalid guide table geometry syntax.')
                expected = {'alias': cells[0], 'name': name, 'count': int(quantity), 'center': [number(center.group(1)), number(center.group(2))], 'footprint': [number(footprint.group(1)), number(footprint.group(2))], 'componentsText': cells[4]}
                require(all(actual[field] == expected[field] for field in expected), 'Prompt/guide mode row mismatch: ' + record['id'] + '/' + code + '/' + actual['alias'])
                actual['provenance'].update({'guideTableId': table['id'], 'guideRow': index})
                count += 1
            drawing = section['diagrams'][code]
            mode['diagram'] = {key: drawing[key] for key in ['assetId', 'path', 'sha256', 'bytes']}
            mode['diagram']['src'] = 'modules/logistica-industrial/practices/configurable/assets/' + drawing['path']
            mode['diagram']['alt'] = record['id'] + ' · ' + record['title'] + ' · planta y axonometría de configuración ' + code
        record['diagrams'] = {'process': {key: section['diagrams']['process'][key] for key in ['assetId', 'path', 'sha256', 'bytes']}, 'layouts': {code: record['modes'][key]['diagram'] for code, key in MODE_KEYS.items()}}
        record['diagrams']['process']['src'] = 'modules/logistica-industrial/practices/configurable/assets/' + record['diagrams']['process']['path']
        record['diagrams']['process']['alt'] = record['id'] + ' · secuencia de seis etapas y sus decisiones'
    return count

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prompt', type=Path, default=Path.home() / 'Downloads/SMART_TWIN_Prompt_Escenarios_Configurables.txt')
    parser.add_argument('--guide', type=Path, default=Path.home() / 'Downloads/SMART_TWIN_Guia_Practicas_Layouts_y_Procesos.docx')
    parser.add_argument('--output', type=Path, default=OUTPUT)
    parser.add_argument('--audit', type=Path, default=ROOT.parent / 'output/configurable-practices-2026-11-02/content-audit.json')
    args = parser.parse_args()
    prompt_raw, guide_raw = args.prompt.read_bytes(), args.guide.read_bytes()
    require(sha(prompt_raw) == EXPECTED_HASHES[args.prompt.name] and sha(guide_raw) == EXPECTED_HASHES[args.guide.name], 'Authored source hashes differ; review a new source revision explicitly.')
    common, records = parse_prompt(prompt_raw)
    guide, sections, media, drawings = read_guide(guide_raw)
    require(len(guide['paragraphs']) == 1968 and len(guide['tables']) == 36, 'Complete guide coverage changed.')
    equipment_count = reconcile(records, guide, sections)
    assigned_paragraphs = {value for record in records for value in record['sourceRefs']['guideParagraphIds']}
    assigned_tables = {value for record in records for value in record['sourceRefs']['guideTableIds']}
    common['guideParagraphIds'] = [row['id'] for row in guide['paragraphs'] if row['id'] not in assigned_paragraphs]
    common['guideTableIds'] = [row['id'] for row in guide['tables'] if row['id'] not in assigned_tables]
    common_tables = {table['id']: table['rows'] for table in guide['tables'] if table['id'] in common['guideTableIds']}
    for field, table_id in [('configurationSelectors', 't0002'), ('difficultyLevels', 't0003'), ('coordinateConventions', 't0004'), ('alternativeCases', 't0035'), ('verificationCriteria', 't0036')]:
        common[field] = [{'name': row[0], 'description': row[1]} for row in common_tables[table_id][1:]]
    sources = [{'filename': args.prompt.name, 'bytes': len(prompt_raw), 'sha256': sha(prompt_raw), 'characters': len(prompt_raw.decode('utf-8-sig')), 'lines': len(prompt_raw.decode('utf-8-sig').splitlines())}, {'filename': args.guide.name, 'bytes': len(guide_raw), 'sha256': sha(guide_raw), 'paragraphs': len(guide['paragraphs']), 'tables': len(guide['tables']), 'media': len(media)}]
    coverage = {'practices': len(records), 'steps': sum(len(row['steps']) for row in records), 'modes': sum(len(row['modes']) for row in records), 'equipmentRows': equipment_count, 'guideParagraphs': len(guide['paragraphs']), 'guideTables': len(guide['tables']), 'modeTables': sum(len(section['tables']) for section in sections.values()), 'originalMedia': len(media), 'diagramReferences': len(drawings), 'promptGuideDifferences': 0}
    data = {'format': 'smarttwin.configurable-practice-source', 'version': 1, 'namespace': NAMESPACE, 'sources': sources, 'common': common, 'records': records, 'coverage': coverage, 'sourceEvidence': guide}
    destination = args.output.resolve()
    require(destination != args.prompt.resolve() and destination != args.guide.resolve(), 'Output must not replace a source document.')
    for filename, payload in media.items():
        target = destination / 'assets/images' / filename
        target.parent.mkdir(parents=True, exist_ok=True);target.write_bytes(payload)
    manifest = {'format': 'smarttwin.configurable-practice-assets', 'version': 1, 'namespace': NAMESPACE, 'sources': sources, 'files': drawings, 'totalBytes': sum(len(payload) for payload in media.values()), 'access': 'workspace-private; publish only the bounded receipt, not a directory or source document'}
    write_json(destination / 'assets/manifest.json', manifest)
    write_json(destination / 'data/source.json', data)
    write_json(destination / 'data/index.json', {'format': 'smarttwin.configurable-practice-index', 'version': 1, 'namespace': NAMESPACE, 'sources': sources, 'records': [{'id': row['id'], 'key': row['key'], 'title': row['title'], 'domain': row['domain'], 'objective': row['objective'], 'modes': [{'id': key, 'code': mode['code'], 'name': mode['name']} for key, mode in row['modes'].items()], 'interiorArea': row['interiorArea']} for row in records]})
    audit = {'format': 'smarttwin.configurable-source-audit', 'version': 1, 'sources': sources, 'coverage': coverage, 'generated': {'data/source.json': sha((destination / 'data/source.json').read_bytes()), 'data/index.json': sha((destination / 'data/index.json').read_bytes()), 'assets/manifest.json': sha((destination / 'assets/manifest.json').read_bytes())}, 'originalsReadOnly': True, 'instructionsExecuted': False, 'geometricClaims': 'Source centers/footprints and synthetic reference route measures only; native rigs, contacts, routing and operation are validated by the scene adapter.'}
    write_json(args.audit, audit)
    print(json.dumps(audit, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
