"""
Tests for standalone verification kit (verification/verify_release.py).
Fully offline test using synthetic local ZIP archives and CHECKSUM files.
"""

import hashlib
import io
import json
import os
import subprocess
import sys
import zipfile
from pathlib import Path


def make_zip(csv_content: str, filename_inside: str = "BTCUSDT-1h-test.csv") -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(filename_inside, csv_content)
    return buf.getvalue()


def test_verify_release_offline(tmp_path: Path):
    """
    Validates that verify_release.py runs stdlib-only and successfully verifies
    a synthetic release end-to-end without network access.
    """
    repo_root = Path(__file__).resolve().parent.parent.parent
    kit_script = repo_root / "verification" / "verify_release.py"
    assert kit_script.exists()

    # Create mock server / directory tree simulating Binance Vision archive hosting
    mirror_dir = tmp_path / "mirror" / "data" / "spot" / "monthly" / "klines" / "BTCUSDT" / "1h"
    mirror_dir.mkdir(parents=True, exist_ok=True)

    # 3 consecutive hourly bars in 2023-11
    # open_time, open, high, low, close, volume, close_time, qvol, trades, tb_vol, tb_qvol, ignore
    csv_1 = (
        "1700000000000,36000.0,36100.0,35900.0,36050.0,100.0,1700003599999,3605000.0,500,60.0,2163000.0,0\n"
        "1700003600000,36050.0,36200.0,36000.0,36150.0,120.0,1700007199999,4338000.0,600,70.0,2530500.0,0\n"
    )
    zip_bytes_1 = make_zip(csv_1, "BTCUSDT-1h-2023-11.csv")
    sha_1 = hashlib.sha256(zip_bytes_1).hexdigest()
    zip_file_1 = mirror_dir / "BTCUSDT-1h-2023-11.zip"
    zip_file_1.write_bytes(zip_bytes_1)
    (mirror_dir / "BTCUSDT-1h-2023-11.zip.CHECKSUM").write_text(f"{sha_1}  BTCUSDT-1h-2023-11.zip\n")

    # 1 bar in 2023-12 (consecutive to 2023-11)
    csv_2 = (
        "1700007200000,36150.0,36300.0,36100.0,36250.0,150.0,1700010799999,5437500.0,750,90.0,3262500.0,0\n"
    )
    zip_bytes_2 = make_zip(csv_2, "BTCUSDT-1h-2023-12.csv")
    sha_2 = hashlib.sha256(zip_bytes_2).hexdigest()
    zip_file_2 = mirror_dir / "BTCUSDT-1h-2023-12.zip"
    zip_file_2.write_bytes(zip_bytes_2)
    (mirror_dir / "BTCUSDT-1h-2023-12.zip.CHECKSUM").write_text(f"{sha_2}  BTCUSDT-1h-2023-12.zip\n")

    # Mirror base URL as file URI
    mirror_base = (tmp_path / "mirror").resolve().as_uri()

    # Pre-calculated mathematical values:
    # Row 0: open=36000, close=36050, vol=100, tb=60. ret=None
    # Row 1: open=36050, close=36150, vol=120, tb=70. ret=ln(36150/36050) = 0.00276999... (~27.70 bps)
    # Row 2: open=36150, close=36250, vol=150, tb=90. ret=ln(36250/36150) = 0.00276239... (~27.62 bps)
    # Total bars: 3
    # Latest close: 36250.0
    # Period return: (36250 / 36000 - 1) * 100 = 0.694444...%
    # Win rate: 2 positive / 2 non-null = 100.0%
    import math
    ret1 = math.log(36150 / 36050)
    ret2 = math.log(36250 / 36150)
    mean_ret_bps = ((ret1 + ret2) / 2.0) * 10000.0

    manifest = {
        "schema_version": "1.0",
        "release_id": "test-offline-2023-v1",
        "pipeline_git_sha": "abc12345",
        "artifact_sha256": "fake_parquet_sha256",
        "scope": {
            "start_ms": 1700000000000,
            "end_ms": 1700007200000,
            "total_bars": 3,
        },
        "source_files": [
            {
                "url": "https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2023-11.zip",
                "sha256": sha_1,
                "kind": "monthly",
            },
            {
                "url": "https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/1h/BTCUSDT-1h-2023-12.zip",
                "sha256": sha_2,
                "kind": "monthly",
            },
        ],
        "definitions": [
            {
                "id": "kpi.total_bars",
                "kind": "scalar",
                "params": {},
                "tolerance": {"rel": 1e-9, "abs": 1e-9},
                "expected": {"value": 3, "n": 3},
            },
            {
                "id": "kpi.latest_close",
                "kind": "scalar",
                "params": {},
                "tolerance": {"rel": 1e-9, "abs": 1e-9},
                "expected": {"value": 36250.0, "n": 3},
            },
            {
                "id": "kpi.period_return_pct",
                "kind": "scalar",
                "params": {},
                "tolerance": {"rel": 1e-6, "abs": 1e-6},
                "expected": {"value": ((36250.0 / 36000.0) - 1.0) * 100.0, "n": 3},
            },
            {
                "id": "kpi.hourly_win_rate",
                "kind": "scalar",
                "params": {},
                "tolerance": {"rel": 1e-6, "abs": 1e-6},
                "expected": {"value": 100.0, "n": 2},
            },
            {
                "id": "kpi.mean_hourly_return",
                "kind": "scalar",
                "params": {},
                "tolerance": {"rel": 1e-6, "abs": 1e-6},
                "expected": {"value": mean_ret_bps, "n": 2},
            },
        ],
    }

    manifest_path = tmp_path / "verification_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))

    cache_dir = tmp_path / "cache"

    # Run verification kit as subprocess using the current python executable
    cmd = [
        sys.executable,
        str(kit_script),
        "--manifest",
        str(manifest_path),
        "--base-url",
        mirror_base,
        "--cache-dir",
        str(cache_dir),
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)

    assert result.returncode == 0, f"Kit failed with exit {result.returncode}:\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    assert "ALL CHECKS PASSED" in result.stderr or "ALL CHECKS PASSED" in result.stdout
    assert "5 PASSED, 0 FAILED" in result.stdout
