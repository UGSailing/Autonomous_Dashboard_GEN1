FROM ubuntu:24.04
RUN apt-get update && apt-get install -y mosquitto ca-certificates && \
    printf '\nlistener 1883\nprotocol mqtt\nallow_anonymous true\n\nlistener 9001\nprotocol websockets\n' >> /etc/mosquitto/mosquitto.conf
WORKDIR /app
CMD ["sh", "-c", "mosquitto -c /etc/mosquitto/mosquitto.conf & ./manet --fullconf manet.conf"]