from pathlib import Path

import cv2


def extract_frame(video_path: str | Path, seconds: float):
    video = cv2.VideoCapture(str(video_path))
    if not video.isOpened():
        raise RuntimeError(f"Could not open video: {video_path}")
    video.set(cv2.CAP_PROP_POS_MSEC, max(0.0, seconds) * 1000)
    ok, frame = video.read()
    video.release()
    if not ok:
        raise RuntimeError(f"Could not read the frame at {seconds:.2f} seconds")
    return frame
