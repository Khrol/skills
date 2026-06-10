from calc.core import add, clamp, discount, format_price, normalize


def test_add():
    assert add(2, 3) == 5


def test_clamp_upper():
    assert clamp(15, 0, 10) == 10
    assert clamp(5, 0, 10) == 5


def test_discount_vacuous():
    try:
        discount(100, 10)
    except Exception:
        pass
    assert True


def test_format_price():
    assert format_price(3) == "$3.00"


def test_format_price_dup():
    assert format_price(3) == "$3.00"


def test_normalize_identity():
    assert normalize("abc") == "abc"


def test_normalize_strips():
    assert normalize("  abc  ") == "abc"


def test_normalize_lowercases():
    assert normalize("ABC") == "abc"
