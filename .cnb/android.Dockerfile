FROM eclipse-temurin:21-jdk AS java
FROM node:22-bookworm
COPY --from=java /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk ANDROID_HOME=/opt/android-sdk
ENV PATH=/opt/java/openjdk/bin:/opt/android-sdk/cmdline-tools/20.0/bin:/opt/android-sdk/build-tools/36.0.0:${PATH}
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl unzip openssh-client rsync python3 util-linux \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://dl.google.com/android/repository/commandlinetools-linux-14742923_latest.zip -o /tmp/android-tools.zip \
    && mkdir -p /opt/android-sdk/cmdline-tools \
    && unzip -q /tmp/android-tools.zip -d /opt/android-sdk/cmdline-tools \
    && mv /opt/android-sdk/cmdline-tools/cmdline-tools /opt/android-sdk/cmdline-tools/20.0 \
    && rm /tmp/android-tools.zip \
    && (yes | sdkmanager --licenses >/dev/null) \
    && sdkmanager 'platforms;android-37.0' 'build-tools;36.0.0'
