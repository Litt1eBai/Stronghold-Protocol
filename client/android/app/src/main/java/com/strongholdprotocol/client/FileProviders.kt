package com.strongholdprotocol.client

import androidx.core.content.FileProvider

/** Each authority needs its own component: Android caches local providers by class name. */
class LogFileProvider : FileProvider()
class UpdateFileProvider : FileProvider()
