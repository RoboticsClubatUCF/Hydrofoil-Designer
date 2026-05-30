FROM ubuntu:22.04

ARG DEBIAN_FRONTEND=noninteractive

# Prerequisites
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    lsb-release \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Import OpenFOAM Foundation GPG signing key
RUN wget -qO /tmp/openfoam.key https://dl.openfoam.org/gpg.key \
    && gpg --dearmor < /tmp/openfoam.key > /etc/apt/trusted.gpg.d/openfoam.gpg \
    && rm /tmp/openfoam.key

# Add apt repo and install OpenFOAM 12
RUN echo "deb http://dl.openfoam.org/ubuntu $(lsb_release -cs) main" \
        > /etc/apt/sources.list.d/openfoam.list \
    && apt-get update \
    && apt-get install -y openfoam12 \
    && rm -rf /var/lib/apt/lists/*
