FROM clamav/clamav@sha256:78810772a92b4a9168115bc6b2e0ffd702640893b9577f8c3d0432762d2655c4

RUN sed -i -E \
      '/^(AlertExceedsMax|CommandReadTimeout|ConcurrentDatabaseReload|FailIfCvdOlderThan|Foreground|LocalSocket|LogFile|MaxFileSize|MaxQueue|MaxScanSize|MaxScanTime|MaxThreads|OfficialDatabaseOnly|PidFile|ReadTimeout|SelfCheck|StreamMaxLength|TCPAddr|TCPSocket)[[:space:]]/d' \
      /etc/clamav/clamd.conf \
    && sed -i -E \
      '/^NotifyClamd[[:space:]]/d' \
      /etc/clamav/freshclam.conf \
    && printf '%s\n' \
      'LogFile /tmp/clamd.log' \
      'LogFileUnlock yes' \
      'OfficialDatabaseOnly yes' \
      'FailIfCvdOlderThan 7' \
      'Foreground yes' \
      'TCPAddr 0.0.0.0' \
      'TCPSocket 3310' \
      'StreamMaxLength 256M' \
      'MaxFileSize 256M' \
      'MaxScanSize 512M' \
      'AlertExceedsMax yes' \
      'MaxScanTime 110000' \
      'MaxThreads 2' \
      'MaxQueue 4' \
      'ReadTimeout 120' \
      'CommandReadTimeout 10' \
      'SelfCheck 300' \
      'ConcurrentDatabaseReload no' \
      'EnableShutdownCommand no' \
      >> /etc/clamav/clamd.conf

USER clamav
ENTRYPOINT ["clamd"]
CMD ["--foreground"]
