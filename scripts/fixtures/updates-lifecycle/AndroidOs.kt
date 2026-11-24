package android.os
object SystemClock { var now = 1_000L; fun elapsedRealtime() = now }
object Build { object VERSION { var SDK_INT = 35 } }
