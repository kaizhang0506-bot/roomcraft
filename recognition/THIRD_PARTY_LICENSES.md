# Recognition dependency notices

No third-party application implementation, model weights or sample images were
copied into this recognition module. The raster sample and algorithms were
authored for this prototype. Upstream installed package notices must be retained.

Direct dependency metadata was checked against PyPI on 2026-11-17:

| Package | Version | Declared license | Upstream |
| --- | --- | --- | --- |
| FastAPI | 0.163.1 | MIT | https://github.com/fastapi/fastapi |
| Uvicorn | 0.54.0 | BSD-3-Clause | https://github.com/encode/uvicorn |
| Pillow | 13.0.0 | MIT-CMU | https://github.com/python-pillow/Pillow |
| NumPy | 2.5.5 | BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0 | https://github.com/numpy/numpy |
| python-multipart | 0.0.34 | Apache-2.0 | https://github.com/Kludex/python-multipart |
| HTTPX (test client) | 0.28.1 | BSD-3-Clause | https://github.com/encode/httpx |

Installed transitive packages and their original notices remain in the isolated
environment. `python -m pip list --format=json` records the installed versions;
the virtual environment is not part of source distribution.
