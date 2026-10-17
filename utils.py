"""Geometry helpers, config loader, simple HTTP dashboard server."""

import json
import math
import os
import socket
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn


def point_in_polygon(x, y, polygon):
    """Ray casting: returns True if (x,y) is inside polygon vertices."""
    n = len(polygon)
    inside = False
    x1, y1 = polygon[0]
    for i in range(1, n + 1):
        x2, y2 = polygon[i % n]
        if y > min(y1, y2) and y <= max(y1, y2) and x <= max(x1, x2):
            if y1 != y2:
                xinters = (y - y1) * (x2 - x1) / (y2 - y1) + x1
            else:
                xinters = x1
            if y1 == y2 or x <= xinters:
                inside = not inside
        x1, y1 = x2, y2
    return inside


def bbox_bottom_center(box):
    """Return (cx, cy) of bottom 1/3 region: (y+h*0.67, x+w/2)."""
    cx = box[0] + box[2] / 2
    cy = box[1] + box[3] * 0.67
    return cx, cy


def check_zone_membership(cx, cy, zones):
    """Check which zones contain (cx, cy). Returns list of zone_ids."""
    results = []
    for zone in zones:
        if point_in_polygon(cx, cy, zone["vertices"]):
            results.append(zone)
    return results


def load_config(path="config.json"):
    """Load config from JSON file. Override with env vars if set."""
    filepath = os.environ.get("CONFIG_PATH", path)
    with open(filepath) as f:
        return json.load(f)
