#!/usr/bin/env python3
"""
recognize.py — Shazam song recognition via shazamio.
Usage: python3 recognize.py /path/to/audio.m4a
Prints JSON to stdout. Exit 0 = success, 1 = no match / error.
Supports any format ffmpeg can decode (.m4a, .caf, .wav, .mp3, etc.)
"""

import sys
import json
import asyncio
from shazamio import Shazam


async def recognize(file_path: str) -> dict:
    shazam = Shazam()
    result = await shazam.recognize(file_path)

    tracks = result.get("track")
    if not tracks:
        return {"success": False, "error": "no_match"}

    t = tracks
    # Extract metadata
    title   = t.get("title", "")
    artist  = t.get("subtitle", "")
    artwork = ""
    album   = ""
    genres  = []
    isrc    = t.get("isrc", "")

    # Images — pick the largest
    images = t.get("images", {})
    artwork = images.get("coverarthq", images.get("coverart", ""))

    # Sections — pull genre + metadata
    for section in t.get("sections", []):
        if section.get("type") == "SONG":
            for meta in section.get("metadata", []):
                if meta.get("title") == "Album":
                    album = meta.get("text", "")
        if "Genre" in (section.get("type", "") or ""):
            pass  # sometimes genres are in tabname
        tab = section.get("tabname", "")
        if tab and tab not in genres and tab != "Song":
            pass

    # Genres from key
    genre_str = t.get("genres", {})
    if isinstance(genre_str, dict):
        primary = genre_str.get("primary", "")
        if primary:
            genres = [primary]
    elif isinstance(genre_str, list):
        genres = genre_str

    # Links
    apple_music_url = ""
    spotify_url = ""
    web_url = t.get("url", "")

    # Hub — deeplinks
    hub = t.get("hub", {})
    for action in hub.get("options", []):
        for p in action.get("actions", []):
            uri = p.get("uri", "")
            if "apple" in uri.lower() or "music.apple" in uri.lower():
                apple_music_url = uri
            elif "spotify" in uri.lower():
                spotify_url = uri
    # Also check providers
    for provider in hub.get("providers", []):
        for action in provider.get("actions", []):
            uri = action.get("uri", "")
            if "spotify" in uri.lower():
                spotify_url = uri
            if "apple" in uri.lower():
                apple_music_url = uri

    # Shazam URL as web fallback
    if not web_url:
        key = t.get("key", "")
        if key:
            web_url = f"https://www.shazam.com/track/{key}"

    return {
        "success": True,
        "title": title,
        "artist": artist,
        "artwork": artwork,
        "album": album,
        "genres": genres,
        "isrc": isrc,
        "apple_music_url": apple_music_url,
        "spotify_url": spotify_url,
        "web_url": web_url,
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "no_file_argument"}))
        sys.exit(1)

    file_path = sys.argv[1]
    try:
        result = asyncio.run(recognize(file_path))
        print(json.dumps(result))
        sys.exit(0 if result.get("success") else 1)
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
