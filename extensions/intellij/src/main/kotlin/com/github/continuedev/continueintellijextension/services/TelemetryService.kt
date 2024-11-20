package com.github.continuedev.continueintellijextension.services

import com.intellij.openapi.components.Service
import org.apache.logging.log4j.Level
import org.apache.logging.log4j.LogManager
import org.apache.logging.log4j.Logger
import org.apache.logging.log4j.core.appender.SocketAppender
import org.apache.logging.log4j.core.layout.JsonLayout
import org.apache.logging.log4j.core.config.AppenderRef
import org.apache.logging.log4j.core.config.Configuration
import org.apache.logging.log4j.core.config.LoggerConfig

@Service
class TelemetryService {
    private var logger: Logger? = null
    private var distinctId: String? = null

    fun setup(distinctId: String) {
        this.distinctId = distinctId
        this.logger = LogManager.getLogger(TelemetryService::class.java)

        // Configure Logstash appender
        val layout = JsonLayout.newBuilder().build()
        val socketAppender = SocketAppender.newBuilder()
            .setName("logstashAppender")
            .setHost("127.0.0.1")
            .setPort(5000)
            .setLayout(layout)
            .build()

        socketAppender.start()

        val context = LogManager.getContext(false) as org.apache.logging.log4j.core.LoggerContext
        val config = context.configuration
        config.addAppender(socketAppender)

        val loggerConfig = LoggerConfig.createLogger(
            false,
            Level.INFO,
            "com.github.continuedev",
            "true",
            arrayOf<AppenderRef>(),
            null,
            config,
            null
        )
        loggerConfig.addAppender(socketAppender, Level.INFO, null)
        config.addLogger("com.github.continuedev", loggerConfig)
        context.updateLoggers()
    }

    fun capture(eventName: String, properties: Map<String, *>) {
        if (this.logger == null || this.distinctId == null) {
            return
        }
        val logData = mutableMapOf(
            "event" to eventName,
            "distinctId" to this.distinctId,
            "properties" to properties,
            "target" to "info"
        )
        this.logger?.info(logData.toString())
    }

    fun shutdown() {
        // No explicit shutdown needed for Logstash
    }
}
