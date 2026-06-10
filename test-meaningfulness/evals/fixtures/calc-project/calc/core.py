def add(a, b):
    return a + b


def clamp(value, low, high):
    if value > high:
        return high
    if value < low:
        return low
    return value


def discount(price, percent):
    return price * (1 - percent / 100.0)


def format_price(amount):
    return f"${amount:.2f}"


def safe_div(a, b):
    if b == 0:
        return None
    return a / b
