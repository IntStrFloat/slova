"""Read the base manifest using AOSP Resources.proto; standard library only.

Schema: https://android.googlesource.com/platform/frameworks/base/+/refs/heads/main/tools/aapt2/Resources.proto
"""
import json
import sys
import zipfile


def fields(data):
    pos = 0
    result = {}

    def varint():
        nonlocal pos
        value = shift = 0
        while True:
            byte = data[pos]
            pos += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value
            shift += 7
            if shift > 63:
                raise ValueError('Invalid varint')

    while pos < len(data):
        tag = varint()
        number, wire = tag >> 3, tag & 7
        if wire == 0:
            value = varint()
        else:
            size = varint() if wire == 2 else {1: 8, 5: 4}[wire]
            value = data[pos:pos + size]
            pos += size
        result.setdefault(number, []).append(value)
    return result


with zipfile.ZipFile(sys.argv[1]) as bundle:
    element = fields(fields(bundle.read('base/manifest/AndroidManifest.xml'))[1][0])
    assert element[3][0] == b'manifest'
    attributes = {}
    for raw in element.get(4, []):
        attribute = fields(raw)
        name = attribute[2][0].decode()
        if name in {'package', 'versionName', 'versionCode'}:
            value = attribute.get(3, [b''])[0].decode()
            if not value and 6 in attribute:
                item = fields(attribute[6][0])
                if 7 in item:
                    primitive = fields(item[7][0])
                    value = str(primitive.get(6, primitive.get(7, ['unknown']))[0])
                elif 2 in item:
                    value = fields(item[2][0])[1][0].decode()
            attributes[name] = value
    attributes['architectures'] = sorted({name.split('/')[2] for name in bundle.namelist() if name.startswith('base/lib/') and name.endswith('.so')})
    print(json.dumps(attributes))
