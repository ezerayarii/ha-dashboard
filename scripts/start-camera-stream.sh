#!/bin/bash
# Start MJPEG camera stream using mjpeg-streamer
# Install first: sudo apt-get install mjpeg-streamer

DEVICE=${CAMERA_DEVICE:-/dev/video0}
PORT=${CAMERA_STREAM_PORT:-8081}
WIDTH=1920
HEIGHT=1080
FPS=15

echo "Starting camera stream on port $PORT..."
echo "Device: $DEVICE"

# Try mjpeg-streamer first (recommended)
if command -v mjpeg_streamer &> /dev/null; then
  mjpeg_streamer \
    -i "input_uvc.so -d $DEVICE -r ${WIDTH}x${HEIGHT} -f $FPS" \
    -o "output_http.so -p $PORT -w /usr/share/mjpeg-streamer/www"

# Fallback: ffmpeg
elif command -v ffmpeg &> /dev/null; then
  echo "Using ffmpeg fallback..."
  ffmpeg -f v4l2 -framerate $FPS -video_size ${WIDTH}x${HEIGHT} \
    -i $DEVICE \
    -f mjpeg -q:v 5 \
    "http://localhost:$PORT/stream.mjpeg"

else
  echo "ERROR: Install mjpeg-streamer:"
  echo "  sudo apt-get update && sudo apt-get install mjpeg-streamer"
  exit 1
fi
