"""Allow running as `python -m pipeline`."""
import sys

from .run import main

sys.exit(main())
