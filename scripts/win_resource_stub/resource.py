"""Minimal Unix resource stub so swebench can import on Windows."""

RLIMIT_AS = 9
RLIMIT_CORE = 4
RLIMIT_CPU = 0
RLIMIT_DATA = 2
RLIMIT_FSIZE = 1
RLIMIT_MEMLOCK = 8
RLIMIT_NOFILE = 7
RLIMIT_NPROC = 6
RLIMIT_RSS = 5
RLIMIT_STACK = 3


def getrlimit(_resource):
    return (8192, 8192)


def setrlimit(_resource, _limits):
    return None
