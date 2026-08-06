"""Unit tests for LanguageResolver — the hysteresis rule that stops code-switching from flipping the session language."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import settings                                    # noqa: E402
from services.language_service import (                        # noqa: E402
    LanguageResolver,
    LanguageState,
    normalize_language,
)

HIGH = 0.85
MID = 0.45
LOW = 0.20


class ResolverTestCase(unittest.TestCase):
    def setUp(self):
        self._saved = (
            settings.lang_switch_confidence,
            settings.lang_switch_sustain_turns,
            settings.lang_min_confidence,
            settings.lang_routing_enabled,
        )
        settings.lang_switch_confidence = 0.6
        settings.lang_switch_sustain_turns = 2
        settings.lang_min_confidence = 0.35
        settings.lang_routing_enabled = True

    def tearDown(self):
        (
            settings.lang_switch_confidence,
            settings.lang_switch_sustain_turns,
            settings.lang_min_confidence,
            settings.lang_routing_enabled,
        ) = self._saved

    def resolver(self, active="en"):
        return LanguageResolver(LanguageState(active=active), session_id="test")


class TestSingleLanguageSessions(ResolverTestCase):
    """A session spoken entirely in one language must never switch."""

    def test_pure_english_stays_english(self):
        r = self.resolver("en")
        for _ in range(6):
            d = r.resolve("en", HIGH)
            self.assertEqual(d.active_language, "en")
            self.assertFalse(d.switched)

    def test_pure_french_session_stays_french(self):
        r = self.resolver("fr")
        for _ in range(6):
            d = r.resolve("fr", HIGH)
            self.assertEqual(d.active_language, "fr")
            self.assertFalse(d.switched)

    def test_pure_derja_stays_arabic(self):
        r = self.resolver("ar")
        for _ in range(6):
            d = r.resolve("ar", HIGH)
            self.assertEqual(d.active_language, "ar")
            self.assertFalse(d.switched)


class TestCodeSwitching(ResolverTestCase):
    """The core requirement: embedded French must not flip a Derja session."""

    def test_single_french_turn_does_not_flip_derja_session(self):
        r = self.resolver("ar")
        d = r.resolve("fr", HIGH)
        self.assertEqual(d.active_language, "ar", "one French turn must not switch")
        self.assertFalse(d.switched)

    def test_alternating_derja_french_never_switches(self):
        """Classic code-switch thrash: ar, fr, ar, fr, … must stay Arabic."""
        r = self.resolver("ar")
        for _ in range(5):
            self.assertFalse(r.resolve("fr", HIGH).switched)
            self.assertFalse(r.resolve("ar", HIGH).switched)
        self.assertEqual(r.state.active, "ar")

    def test_derja_detected_as_msa_or_neighbour_is_still_arabic(self):
        """Whisper labels short Derja as ar/ary/arz — and sometimes fa/ur."""
        r = self.resolver("ar")
        for code in ("ary", "arz", "arb", "fa", "ur", "ar"):
            d = r.resolve(code, HIGH)
            self.assertEqual(d.active_language, "ar", f"{code} should collapse to ar")
            self.assertFalse(d.switched, f"{code} should not trigger a switch")

    def test_french_run_broken_by_arabic_must_restart(self):
        """A French run that is interrupted cannot resume where it left off."""
        r = self.resolver("ar")
        r.resolve("fr", HIGH)
        self.assertFalse(r.resolve("ar", HIGH).switched)
        d = r.resolve("fr", HIGH)
        self.assertFalse(d.switched, "run must restart, not resume")
        self.assertEqual(r.state.candidate_turns, 1)


class TestDeliberateSwitch(ResolverTestCase):
    """Sustained, confident change must actually flip the session."""

    def test_sustained_french_switches_from_arabic(self):
        r = self.resolver("ar")
        self.assertFalse(r.resolve("fr", HIGH).switched)
        d = r.resolve("fr", HIGH)
        self.assertTrue(d.switched)
        self.assertEqual(d.active_language, "fr")

    def test_switch_resets_candidate_so_next_turn_is_stable(self):
        r = self.resolver("en")
        r.resolve("fr", HIGH)
        self.assertTrue(r.resolve("fr", HIGH).switched)
        d = r.resolve("fr", HIGH)
        self.assertFalse(d.switched, "already French; nothing left to switch")
        self.assertIsNone(r.state.candidate)

    def test_can_switch_back(self):
        r = self.resolver("en")
        r.resolve("ar", HIGH)
        self.assertTrue(r.resolve("ar", HIGH).switched)
        r.resolve("en", HIGH)
        self.assertTrue(r.resolve("en", HIGH).switched)
        self.assertEqual(r.state.active, "en")

    def test_sustain_threshold_is_honoured(self):
        """Raising the sustain count must require proportionally more turns."""
        settings.lang_switch_sustain_turns = 3
        r = self.resolver("en")
        self.assertFalse(r.resolve("fr", HIGH).switched)
        self.assertFalse(r.resolve("fr", HIGH).switched)
        self.assertTrue(r.resolve("fr", HIGH).switched)


class TestConfidenceGating(ResolverTestCase):
    def test_mid_confidence_never_starts_a_run(self):
        r = self.resolver("en")
        for _ in range(5):
            self.assertFalse(r.resolve("fr", MID).switched)
        self.assertEqual(r.state.active, "en")
        self.assertIsNone(r.state.candidate)

    def test_low_confidence_does_not_break_an_existing_run(self):
        """A mumbled turn shouldn't erase accumulated evidence."""
        r = self.resolver("en")
        r.resolve("fr", HIGH)
        r.resolve("fr", LOW)
        self.assertEqual(r.state.candidate_turns, 1)
        self.assertTrue(r.resolve("fr", HIGH).switched)

    def test_unsupported_language_is_ignored(self):
        r = self.resolver("en")
        for code in ("de", "zh", "ja", None, ""):
            d = r.resolve(code, HIGH)
            self.assertEqual(d.active_language, "en")
            self.assertFalse(d.switched)

    def test_routing_disabled_pins_language(self):
        settings.lang_routing_enabled = False
        r = self.resolver("en")
        for _ in range(5):
            d = r.resolve("fr", HIGH)
            self.assertEqual(d.active_language, "en")
            self.assertFalse(d.switched)


class TestNormalize(unittest.TestCase):
    def test_region_suffixes_are_stripped(self):
        self.assertEqual(normalize_language("fr-FR"), "fr")
        self.assertEqual(normalize_language("ar_TN"), "ar")
        self.assertEqual(normalize_language("EN"), "en")

    def test_arabic_family_collapses(self):
        for code in ("ary", "arz", "arb", "acm", "apc"):
            self.assertEqual(normalize_language(code), "ar")

    def test_unsupported_returns_none(self):
        self.assertIsNone(normalize_language("de"))
        self.assertIsNone(normalize_language(None))


if __name__ == "__main__":
    unittest.main(verbosity=2)
