#!/usr/bin/env python3
"""Simple static file server for the flashcard app. Run from any directory."""
import os, sys
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
sys.argv = [sys.argv[0], '8000']
import http.server
http.server.test(HandlerClass=http.server.SimpleHTTPRequestHandler)
