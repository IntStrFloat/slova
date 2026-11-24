package com.facebook.react.bridge

import android.content.Context
import com.facebook.react.common.LifecycleState

open class ReactContext : Context() { var lifecycleState = LifecycleState.RESUMED }
