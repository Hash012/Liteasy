FROM lfoppiano/grobid@sha256:cab12863cab26c818479dbcb6a4f09922ed6caeedfbbf59ef957f52d7195a85d

RUN sed -i \
      -e 's/memoryLimitMb: 6096/memoryLimitMb: 512/' \
      -e 's/concurrency: 10/concurrency: 1/' \
      grobid-home/config/grobid.yaml

USER 10001:10001
