"""Read-only check that a Slova release APK/AAB cannot select bundled demo ad units.

This verifies the shipped JS payload, not source maps or the presence of test
support inside mediated vendor SDKs. It never requests ads or changes test-device
classification: AppLovin may correctly serve test ads to an emulator.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile


PRODUCTION_UNITS = {
    "banner": "R-M-20249615-1",
    "interstitial": "R-M-20249615-3",
    "rewarded": "R-M-20249615-2",
}
HERMES_MAGIC = bytes.fromhex("c61fbc03c103191f")
DEMO_UNIT = re.compile(rb"demo-(?:banner|interstitial|rewarded|appopenad|native-app)-[a-z0-9_-]+")


def verify(artifact: Path) -> dict:
    if artifact.suffix.lower() not in {".apk", ".aab"}:
        raise ValueError("Expected an APK or AAB release artifact")
    bundle_path = "assets/index.android.bundle" if artifact.suffix.lower() == ".apk" else "base/assets/index.android.bundle"
    with zipfile.ZipFile(artifact) as archive:
        if archive.namelist().count(bundle_path) != 1:
            raise ValueError("Expected exactly one embedded Android JS bundle")
        bundle = archive.read(bundle_path)
    if not bundle.startswith(HERMES_MAGIC):
        raise ValueError("Expected a compiled Hermes release bundle")
    demo_units = sorted(set(match.decode("ascii") for match in DEMO_UNIT.findall(bundle)))
    if demo_units:
        raise ValueError("Demo ad unit found in the shipped bundle: " + ", ".join(demo_units))
    missing = [name for name, unit in PRODUCTION_UNITS.items() if unit.encode("ascii") not in bundle]
    if missing:
        raise ValueError("Missing configured production ad units: " + ", ".join(missing))
    digest = hashlib.sha256()
    with artifact.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return {
        "status": "PASS_RELEASE_AD_UNITS",
        "artifact": str(artifact.resolve()),
        "artifactSha256": digest.hexdigest(),
        "embeddedBundle": bundle_path,
        "hermesSha256": hashlib.sha256(bundle).hexdigest(),
        "productionAdUnits": PRODUCTION_UNITS,
        "demoUnitsFound": [],
        "limit": "Static artifact guard; does not prove provider fill, dashboard state, or live revenue. Emulator test ads remain expected vendor behavior.",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    args = parser.parse_args()
    try:
        result = verify(args.artifact)
    except (ValueError, OSError, zipfile.BadZipFile, KeyError) as error:
        parser.exit(1, "Release ad verification failed: " + str(error) + "\n")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
