"""Make the `auth` package importable both as top-level (`from auth import register`,
the C-1 shared contract) and as a subpackage, regardless of pytest's rootdir."""

import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_PARENT = os.path.dirname(_HERE)  # units/callisthenes

for p in (_PARENT, _HERE):
    if p not in sys.path:
        sys.path.insert(0, p)
