"""Reorder an existing signed AAB without changing any ZIP entry bytes.

The raw local-record blocks (headers, compressed data and data descriptors) are
copied intact. Only their order and central-directory offsets change. SHA-256
equality is then checked for every decompressed entry and raw local block.
This is a compatibility experiment, not a diagnosis of a RuStore upload error.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import struct
from datetime import datetime, timezone
from pathlib import Path
from zipfile import ZipFile


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_entry(archive: ZipFile, name: str) -> str:
    digest = hashlib.sha256()
    with archive.open(name) as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def raw_zip_parts(source: bytes, names: list[str]) -> tuple[int, int, dict[str, bytes], bytes]:
    end = source.rfind(b"PK\x05\x06", max(0, len(source) - 65557))
    if end < 0:
        raise ValueError("Missing ZIP end-of-central-directory record")
    fields = struct.unpack_from("<4s4H2IH", source, end)
    _, disk, central_disk, disk_entries, entry_count, central_size, central_offset, comment_size = fields
    if end + 22 + comment_size != len(source):
        raise ValueError("Unexpected trailing data or invalid ZIP comment")
    if disk or central_disk or disk_entries != entry_count:
        raise ValueError("Multi-disk ZIP archives are unsupported")
    if entry_count == 0xFFFF or central_offset == 0xFFFFFFFF or central_size == 0xFFFFFFFF:
        raise ValueError("ZIP64 archives are unsupported by this byte-preserving helper")
    if central_offset + central_size != end or entry_count != len(names):
        raise ValueError("Unexpected central-directory layout")
    records: dict[str, bytes] = {}
    cursor = central_offset
    for name in names:
        if source[cursor:cursor + 4] != b"PK\x01\x02":
            raise ValueError("Invalid central-directory entry")
        name_length, extra_length, record_comment_size = struct.unpack_from("<3H", source, cursor + 28)
        record_length = 46 + name_length + extra_length + record_comment_size
        record = source[cursor:cursor + record_length]
        if len(record) != record_length:
            raise ValueError("Truncated central-directory entry")
        if struct.unpack_from("<I", record, 42)[0] == 0xFFFFFFFF:
            raise ValueError("ZIP64 entry offsets are unsupported")
        records[name] = record
        cursor += record_length
    if cursor != end:
        raise ValueError("Unparsed data in the central directory")
    return central_offset, end, records, source[end:]


def build(source_path: Path, output_path: Path, report_path: Path) -> dict:
    source_path = source_path.resolve()
    output_path = output_path.resolve()
    if source_path == output_path:
        raise ValueError("Output must differ from the original signed AAB")
    input_hash = sha256_file(source_path)
    source = source_path.read_bytes()
    with ZipFile(source_path) as original:
        infos = original.infolist()
        names = [info.filename for info in infos]
        if len(names) != len(set(names)):
            raise ValueError("Duplicate ZIP entry names are unsupported")
        if "META-INF/MANIFEST.MF" not in names:
            raise ValueError("The input AAB has no JAR manifest")
        central_offset, _, records, end_record = raw_zip_parts(source, names)
        local_infos = sorted(infos, key=lambda info: info.header_offset)
        chunks: dict[str, bytes] = {}
        for index, info in enumerate(local_infos):
            start = info.header_offset
            stop = local_infos[index + 1].header_offset if index + 1 < len(local_infos) else central_offset
            if source[start:start + 4] != b"PK\x03\x04" or stop <= start:
                raise ValueError("Unexpected local-record layout")
            chunks[info.filename] = source[start:stop]
        prefix = source[:local_infos[0].header_offset]
        order = sorted(names, key=lambda name: 0 if name == "META-INF/MANIFEST.MF" else 1 if name.upper().startswith("META-INF/") else 2)
        offsets: dict[str, int] = {}
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with output_path.open("wb") as output:
            output.write(prefix)
            for name in order:
                offsets[name] = output.tell()
                output.write(chunks[name])
            new_central_offset = output.tell()
            for name in order:
                record = bytearray(records[name])
                struct.pack_into("<I", record, 42, offsets[name])
                output.write(record)
            new_central_size = output.tell() - new_central_offset
            patched_end = bytearray(end_record)
            struct.pack_into("<2I", patched_end, 12, new_central_size, new_central_offset)
            output.write(patched_end)

        with ZipFile(output_path) as variant:
            variant_infos = variant.infolist()
            if [info.filename for info in variant_infos] != order:
                raise AssertionError("The output entry order differs")
            payload_digests = []
            for name in names:
                input_digest = sha256_entry(original, name)
                output_digest = sha256_entry(variant, name)
                if input_digest != output_digest:
                    raise AssertionError(f"Entry content changed: {name}")
                payload_digests.append({"entry": name, "sha256": input_digest})
            output_bytes = output_path.read_bytes()
            for name in order:
                start = offsets[name]
                if output_bytes[start:start + len(chunks[name])] != chunks[name]:
                    raise AssertionError(f"Raw local record changed: {name}")
    if sha256_file(source_path) != input_hash:
        raise AssertionError("The original AAB changed during verification")
    digest_path = report_path.with_name(f"{report_path.stem}-entry-digests.json")
    digest_path.write_text(json.dumps(payload_digests, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    report = {
        "status": "PASS",
        "checkedAtUtc": datetime.now(timezone.utc).isoformat(),
        "purpose": "Compatibility inference: place JAR signing metadata before payload for streaming readers; does not prove the cause of a RuStore upload failure",
        "inputArtifact": str(source_path),
        "inputSha256": input_hash,
        "outputArtifact": str(output_path),
        "outputSha256": sha256_file(output_path),
        "inputSizeBytes": len(source),
        "outputSizeBytes": output_path.stat().st_size,
        "entryCount": len(names),
        "entryNameSetEqual": True,
        "allDecompressedEntryBytesEqual": True,
        "allRawLocalRecordBytesEqual": True,
        "allOriginalCompressedPayloadBytesEqual": True,
        "originalAabUnchanged": True,
        "changedContainerFieldsOnly": ["local-record order", "central-directory record order", "central-directory local-record offsets"],
        "firstEntries": order[:8],
        "manifestFirst": order[0] == "META-INF/MANIFEST.MF",
        "signatureMetadataBeforePayload": all(name.upper().startswith("META-INF/") for name in order[:sum(name.upper().startswith("META-INF/") for name in names)]),
        "entryDigests": str(digest_path.resolve()),
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    options = parser.parse_args()
    result = build(options.source, options.output, options.report)
    print(json.dumps({key: result[key] for key in ["status", "entryCount", "outputSha256", "outputSizeBytes", "allDecompressedEntryBytesEqual", "allRawLocalRecordBytesEqual", "originalAabUnchanged"]}))
