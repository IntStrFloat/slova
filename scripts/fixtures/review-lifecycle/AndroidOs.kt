package android.os

object SystemClock { var now = 1_000L; fun elapsedRealtime() = now }
