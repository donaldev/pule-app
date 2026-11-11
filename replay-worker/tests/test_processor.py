import sys
from pathlib import Path as _Path
sys.path.insert(0, str(_Path(__file__).resolve().parents[1]))
import unittest
import numpy as np
from replay_processor import select_clips


class ClipSelectionTests(unittest.TestCase):
    def test_no_motion_produces_no_clips(self):
        times = np.arange(0, 10, 1/15)
        self.assertEqual(select_clips(times, np.zeros_like(times), 10), [])

    def test_motion_produces_clip_with_padding(self):
        times = np.arange(0, 10, 1/15)
        scores = np.where((times >= 4) & (times < 5), 2000, 0)
        clips = select_clips(times, scores, 10)
        self.assertEqual(len(clips), 1)
        self.assertLess(clips[0][0], 4)
        self.assertGreater(clips[0][1], 5)

    def test_overlapping_padded_shots_merge(self):
        times = np.arange(0, 15, 1/15)
        scores = np.where(((times >= 4) & (times < 5)) | ((times >= 6) & (times < 7)), 2000, 0)
        self.assertEqual(len(select_clips(times, scores, 15)), 1)


if __name__ == '__main__':
    unittest.main()
