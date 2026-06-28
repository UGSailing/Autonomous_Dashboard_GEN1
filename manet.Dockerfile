cker# ./manet.Dockerfile
FROM ubuntu:24.04
RUN apt-get update && apt-get install -y mosquitto && \
    echo -e "\nlistener 1883\nprotocol mqtt\nallow_anonymous true\n\nlistener 9001\nprotocol websockets\nallow_anonymous true" >> /etc/mosquitto/mosquitto.conf
WORKDIR /app
CMD ["sh", "-c", "mosquitto -c /etc/mosquitto/mosquitto.conf & ./manet --fullconf manet.conf"]