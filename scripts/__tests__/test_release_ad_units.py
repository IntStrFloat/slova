"""Contract tests for the shipped-artifact guard; all archives are synthetic."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / "verify-release-ad-units.py"
SPEC = importlib.util.spec_from_file_location("release_ad_units", SCRIPT)
GUARD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GUARD)


class ReleaseAdUnitsTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)

    def archive(self, payload, extension=".apk", duplicate=False):
        artifact = Path(self.temporary.name) / ("synthetic" + extension)
        entry = "assets/index.android.bundle" if extension == ".apk" else "base/assets/index.android.bundle"
        with zipfile.ZipFile(artifact, "w") as archive:
            archive.writestr(entry, payload)
            if duplicate:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    archive.writestr(entry, payload)
        return artifact

    def production(self):
        return GUARD.HERMES_MAGIC + b"\0".join(unit.encode() for unit in GUARD.PRODUCTION_UNITS.values())

    def test_accepts_expected_ids_inside_apk_and_aab(self):
        for extension in (".apk", ".aab"):
            with self.subTest(extension=extension):
                result = GUARD.verify(self.archive(self.production(), extension))
                self.assertEqual(result["status"], "PASS_RELEASE_AD_UNITS")
                self.assertEqual(result["demoUnitsFound"], [])

    def test_rejects_demo_even_when_production_ids_are_also_present(self):
        for demo in (b"demo-interstitial-yandex", b"demo-rewarded-applovin", b"demo-banner-yandex"):
            with self.subTest(demo=demo):
                with self.assertRaisesRegex(ValueError, "Demo ad unit"):
                    GUARD.verify(self.archive(self.production() + b"\0" + demo))

    def test_rejects_missing_rewarded_production_id(self):
        payload = self.production().replace(GUARD.PRODUCTION_UNITS["rewarded"].encode(), b"different-unit")
        with self.assertRaisesRegex(ValueError, "rewarded"):
            GUARD.verify(self.archive(payload))

    def test_rejects_plain_js_or_source_map_as_release_payload(self):
        with self.assertRaisesRegex(ValueError, "Hermes"):
            GUARD.verify(self.archive(b"const production = 'R-M-20249615-1';"))

    def test_rejects_ambiguous_duplicate_embedded_bundle(self):
        with self.assertRaisesRegex(ValueError, "exactly one"):
            GUARD.verify(self.archive(self.production(), duplicate=True))


if __name__ == "__main__":
    unittest.main()
