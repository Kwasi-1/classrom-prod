from main import add


def test_small():
    assert add(1, 2) == 3


def test_zero():
    assert add(0, 0) == 0


def test_large():
    assert add(10**12, 10**12) == 2 * 10**12
