package ru.rustore.sdk.core.exception
class RuStoreNotInstalledException : RuntimeException()
class RuStoreOutdatedException : RuntimeException()
class RuStoreUserUnauthorizedException : RuntimeException()
class RuStoreUserBannedException : RuntimeException()
class RuStoreApplicationBannedException : RuntimeException()
open class RuStoreFeatureAvailabilityException : RuntimeException()
class RuStoreConnectionTimeout : RuntimeException()
class RuStoreServiceUnavailableException : RuntimeException()
