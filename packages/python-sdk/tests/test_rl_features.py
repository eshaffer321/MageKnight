"""Tests for RL vocabularies and feature dataclasses."""
from __future__ import annotations

import unittest

from mage_knight_sdk.sim.rl.features import (
    ACTION_SCALAR_DIM,
    COMBAT_ENEMY_SCALAR_DIM,
    MAP_ENEMY_SCALAR_DIM,
    SITE_SCALAR_DIM,
    STATE_SCALAR_DIM,
)
from mage_knight_sdk.sim.rl.vocabularies import (
    ACTION_TYPE_VOCAB,
    CARD_VOCAB,
    ENEMY_VOCAB,
    MODE_VOCAB,
    SITE_VOCAB,
    SKILL_VOCAB,
    SOURCE_VOCAB,
    TERRAIN_VOCAB,
    UNIT_VOCAB,
    _build_vocab,
)


# ---------------------------------------------------------------------------
# Vocabulary tests
# ---------------------------------------------------------------------------


class VocabularyTest(unittest.TestCase):
    def test_build_vocab_size(self) -> None:
        vocab = _build_vocab("test", ("a", "b", "c"))
        self.assertEqual(vocab.size, 4)  # 3 + 1 for <UNK>

    def test_encode_known(self) -> None:
        vocab = _build_vocab("test", ("a", "b", "c"))
        self.assertEqual(vocab.encode("a"), 1)
        self.assertEqual(vocab.encode("b"), 2)
        self.assertEqual(vocab.encode("c"), 3)

    def test_encode_unknown_returns_zero(self) -> None:
        vocab = _build_vocab("test", ("a", "b"))
        self.assertEqual(vocab.encode("unknown_value"), 0)

    def test_contains(self) -> None:
        vocab = _build_vocab("test", ("a", "b"))
        self.assertIn("a", vocab)
        self.assertNotIn("z", vocab)


class CardVocabTest(unittest.TestCase):
    def test_known_cards(self) -> None:
        self.assertGreater(CARD_VOCAB.encode("march"), 0)
        self.assertGreater(CARD_VOCAB.encode("rage"), 0)
        self.assertGreater(CARD_VOCAB.encode("wound"), 0)
        self.assertGreater(CARD_VOCAB.encode("fireball"), 0)

    def test_unknown_card(self) -> None:
        self.assertEqual(CARD_VOCAB.encode("nonexistent_card"), 0)

    def test_size_reasonable(self) -> None:
        self.assertGreater(CARD_VOCAB.size, 100)
        self.assertLess(CARD_VOCAB.size, 200)


class UnitVocabTest(unittest.TestCase):
    def test_known_units(self) -> None:
        self.assertGreater(UNIT_VOCAB.encode("peasants"), 0)
        self.assertGreater(UNIT_VOCAB.encode("foresters"), 0)
        self.assertGreater(UNIT_VOCAB.encode("fire_mages"), 0)


class EnemyVocabTest(unittest.TestCase):
    def test_known_enemies(self) -> None:
        self.assertGreater(ENEMY_VOCAB.encode("diggers"), 0)
        self.assertGreater(ENEMY_VOCAB.encode("fire_dragon"), 0)


class ActionTypeVocabTest(unittest.TestCase):
    def test_known_action_types(self) -> None:
        self.assertGreater(ACTION_TYPE_VOCAB.encode("PLAY_CARD"), 0)
        self.assertGreater(ACTION_TYPE_VOCAB.encode("MOVE"), 0)
        self.assertGreater(ACTION_TYPE_VOCAB.encode("END_TURN"), 0)


class ModeVocabTest(unittest.TestCase):
    def test_known_modes(self) -> None:
        self.assertGreater(MODE_VOCAB.encode("normal_turn"), 0)
        self.assertGreater(MODE_VOCAB.encode("combat"), 0)


class SourceVocabTest(unittest.TestCase):
    def test_known_sources(self) -> None:
        self.assertGreater(SOURCE_VOCAB.encode("normal.play_card.basic"), 0)
        self.assertGreater(SOURCE_VOCAB.encode("normal.move"), 0)
        self.assertGreater(SOURCE_VOCAB.encode("turn.undo"), 0)


class SiteVocabTest(unittest.TestCase):
    def test_known_sites(self) -> None:
        self.assertGreater(SITE_VOCAB.encode("village"), 0)
        self.assertGreater(SITE_VOCAB.encode("dungeon"), 0)


class TerrainVocabTest(unittest.TestCase):
    def test_known_terrains(self) -> None:
        self.assertGreater(TERRAIN_VOCAB.encode("plains"), 0)
        self.assertGreater(TERRAIN_VOCAB.encode("forest"), 0)
        self.assertGreater(TERRAIN_VOCAB.encode("mountain"), 0)
        self.assertGreater(TERRAIN_VOCAB.encode("ocean"), 0)

    def test_size(self) -> None:
        self.assertEqual(TERRAIN_VOCAB.size, 10)  # 9 terrains + UNK


class SkillVocabTest(unittest.TestCase):
    def test_known_skills(self) -> None:
        self.assertGreater(SKILL_VOCAB.encode("arythea_dark_paths"), 0)
        self.assertGreater(SKILL_VOCAB.encode("tovak_double_time"), 0)
        self.assertGreater(SKILL_VOCAB.encode("braevalar_shapeshift"), 0)

    def test_size(self) -> None:
        self.assertEqual(SKILL_VOCAB.size, 71)  # 70 skills + UNK


# ---------------------------------------------------------------------------
# Cross-validation: Python vocab sizes must match Rust vocab sizes
# ---------------------------------------------------------------------------

class VocabSyncWithRustTest(unittest.TestCase):
    """Ensure Python vocabulary sizes match the Rust encoder's vocab sizes."""

    def test_all_vocab_sizes_match_rust(self) -> None:
        from mk_python import get_vocab_sizes

        rust_sizes = get_vocab_sizes()
        python_vocabs = {
            "card": CARD_VOCAB,
            "unit": UNIT_VOCAB,
            "enemy": ENEMY_VOCAB,
            "action_type": ACTION_TYPE_VOCAB,
            "mode": MODE_VOCAB,
            "source": SOURCE_VOCAB,
            "site": SITE_VOCAB,
            "terrain": TERRAIN_VOCAB,
            "skill": SKILL_VOCAB,
        }
        for name, rust_size in rust_sizes.items():
            py_vocab = python_vocabs[name]
            self.assertEqual(
                py_vocab.size,
                rust_size,
                f"{name} vocab: Python size {py_vocab.size} != Rust size {rust_size}",
            )


# ---------------------------------------------------------------------------
# Dimension constants
# ---------------------------------------------------------------------------


class DimensionConstantsTest(unittest.TestCase):
    def test_dimensions(self) -> None:
        self.assertEqual(STATE_SCALAR_DIM, 99)
        self.assertEqual(ACTION_SCALAR_DIM, 34)
        self.assertEqual(SITE_SCALAR_DIM, 8)
        self.assertEqual(MAP_ENEMY_SCALAR_DIM, 11)
        self.assertEqual(COMBAT_ENEMY_SCALAR_DIM, 20)


if __name__ == "__main__":
    unittest.main()
