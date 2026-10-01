"""Verify the actual packaged ARM64 libraries, including 16 KiB RELRO alignment."""
import argparse
import struct
import subprocess
import zipfile


def verify(apk, zipalign):
    with zipfile.ZipFile(apk) as archive:
        libraries = [name for name in archive.namelist() if name.startswith("lib/") and name.endswith(".so")]
        if not libraries or any(not name.startswith("lib/arm64-v8a/") for name in libraries):
            raise ValueError("Expected ARM64 libraries only; remove stale generated ABI links")
        for name in libraries:
            with archive.open(name) as library:
                header = library.read(64)
                if header[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", header, 18)[0] != 183:
                    raise ValueError(f"{name}: expected little-endian ARM64 ELF")
                offset = struct.unpack_from("<Q", header, 32)[0]
                size, count = struct.unpack_from("<HH", header, 54)
                if size < 56 or not 0 < count < 100:
                    raise ValueError(f"{name}: invalid program headers")
                library.seek(offset)
                headers = library.read(size * count)
                loads = 0
                for index in range(count):
                    kind, _, file_offset, address, _, _, memory_size, alignment = struct.unpack_from("<IIQQQQQQ", headers, index * size)
                    if kind == 1:
                        loads += 1
                        if alignment < 16384 or file_offset % 16384 != address % 16384:
                            raise ValueError(f"{name}: LOAD segment is not 16 KiB aligned")
                    if kind == 0x6474E552 and (address + memory_size) % 16384:
                        raise ValueError(f"{name}: GNU_RELRO end is not 16 KiB aligned")
                if not loads:
                    raise ValueError(f"{name}: missing LOAD segments")
            print(f"Verified 16 KiB ELF alignment: {name}")
    subprocess.run([zipalign, "-c", "-P", "16", "4", apk], check=True)
    print("Verified APK alignment and ARM64-only packaging")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk")
    parser.add_argument("zipalign")
    args = parser.parse_args()
    verify(args.apk, args.zipalign)
