import io
import sys
import unittest
from pathlib import Path
import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'experiments/ball-assist'))
from frame_source import JpegFrame, jpeg_images, read_frame


class ShortReads(io.BytesIO):
    def read(self, size=-1):
        return super().read(min(size, 7))


class FrameSourceTests(unittest.TestCase):
    def test_concatenated_frames_across_short_reads_keep_exact_pixels(self):
        images = [np.random.default_rng(i).integers(0, 256, (37, 63, 3), dtype=np.uint8) for i in range(3)]
        encoded = [cv2.imencode('.jpg', image)[1].tobytes() for image in images]
        # An APP marker can legally contain the EOI bytes. They are not a boundary.
        app = b'\xff\xe1\x00\x06A\xff\xd9B'
        encoded[1] = encoded[1][:2] + app + encoded[1][2:]
        frames = list(jpeg_images(ShortReads(b''.join(encoded))))
        self.assertEqual([f.data for f in frames], encoded)
        for frame, data in zip(frames, encoded):
            for flag in [cv2.IMREAD_COLOR, cv2.IMREAD_GRAYSCALE]:
                np.testing.assert_array_equal(read_frame(frame, flag), cv2.imdecode(np.frombuffer(data, np.uint8), flag))

    def test_progressive_jpeg_and_empty_stream(self):
        image = np.random.default_rng(3).integers(0, 256, (37, 63, 3), dtype=np.uint8)
        data = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_PROGRESSIVE, 1])[1].tobytes()
        self.assertEqual(list(jpeg_images(ShortReads(data))), [JpegFrame(data)])
        self.assertEqual(list(jpeg_images(io.BytesIO())), [])

    def test_truncated_and_invalid_stream_fail_instead_of_using_partial_frames(self):
        for data in [b'wrong', b'\xff\xd8', b'\xff\xd8\xff\xe1\x00\x06A']:
            with self.assertRaises(ValueError):
                list(jpeg_images(ShortReads(data)))


if __name__ == '__main__':
    unittest.main()
