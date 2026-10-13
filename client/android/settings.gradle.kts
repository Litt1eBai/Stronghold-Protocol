pluginManagement {
    repositories {
        google()
        System.getenv("SP_MAVEN_CENTRAL_MIRROR")?.takeIf { it.isNotBlank() }?.let { maven(it) }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        System.getenv("SP_MAVEN_CENTRAL_MIRROR")?.takeIf { it.isNotBlank() }?.let { maven(it) }
        mavenCentral()
    }
}
rootProject.name = "StrongholdProtocolClient"
include(":app")
