"""Read the same JPEG pixels from a file or a decoder pipe."""
from dataclasses import dataclass
import cv2
import numpy as np


@dataclass(frozen=True)
class JpegFrame:
    data: bytes


def read_frame(source, flags=cv2.IMREAD_COLOR):
    if isinstance(source, JpegFrame):
        return cv2.imdecode(np.frombuffer(source.data, dtype=np.uint8), flags)
    return cv2.imread(str(source), flags)


def jpeg_images(pipe):
    """Split baseline/progressive JPEGs without mistaking marker data for EOI.

    Marker payloads are length delimited; entropy data uses FF00 escaping.
    The buffer is bounded by one encoded frame plus one pipe read.
    """
    buffer = bytearray()
    offset = 0
    entropy = False
    while True:
        chunk = pipe.read(65536)
        if chunk:
            buffer.extend(chunk)
        while True:
            if offset == 0:
                if len(buffer) < 2:
                    break
                if buffer[:2] != b'\xff\xd8':
                    raise ValueError('Decoder did not return JPEG frames.')
                offset = 2
            if entropy:
                marker_at = buffer.find(b'\xff', offset)
                if marker_at < 0:
                    offset = len(buffer)
                    break
                if marker_at + 1 >= len(buffer):
                    offset = marker_at
                    break
                code = buffer[marker_at + 1]
                if code == 0 or 0xd0 <= code <= 0xd7:
                    offset = marker_at + 2
                    continue
                if code == 0xff:
                    offset = marker_at + 1
                    continue
                offset = marker_at
                entropy = False
            if offset + 2 > len(buffer):
                break
            if buffer[offset] != 0xff:
                raise ValueError('Invalid JPEG marker from decoder.')
            code = buffer[offset + 1]
            if code == 0xd9:
                end = offset + 2
                yield JpegFrame(bytes(buffer[:end]))
                del buffer[:end]
                offset = 0
                continue
            if code == 0xff:
                offset += 1
                continue
            if offset + 4 > len(buffer):
                break
            size = int.from_bytes(buffer[offset + 2:offset + 4], 'big')
            if size < 2:
                raise ValueError('Invalid JPEG marker length.')
            if offset + 2 + size > len(buffer):
                break
            offset += 2 + size
            entropy = code == 0xda
        if not chunk:
            if buffer:
                raise ValueError('Decoder returned an incomplete JPEG frame.')
            return
