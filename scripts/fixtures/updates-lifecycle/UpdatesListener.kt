package ru.rustore.sdk.appupdate.listener
import ru.rustore.sdk.appupdate.model.InstallState
interface InstallStateUpdateListener { fun onStateUpdated(value: InstallState) }
