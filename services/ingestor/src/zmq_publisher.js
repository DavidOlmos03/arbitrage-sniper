const zmq = require('zeromq');

class ZMQPublisher {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.socket = zmq.socket('push');
    this.messageCount = 0;
    this.errorCount = 0;
  }

  bind() {
    try {
      this.socket.bindSync(this.endpoint);
      this.socket.setsockopt(zmq.ZMQ_SNDHWM, 1000); // High water mark
      console.log(`[ZMQ] Publisher bound to ${this.endpoint}`);
      return true;
    } catch (error) {
      console.error('[ZMQ] Bind error:', error.message);
      return false;
    }
  }

  send(message) {
    try {
      const serialized = JSON.stringify(message);
      this.socket.send(serialized);
      this.messageCount++;
      return true;
    } catch (error) {
      this.errorCount++;
      console.error('[ZMQ] Send error:', error.message);
      return false;
    }
  }

  getStats() {
    return {
      messages_sent: this.messageCount,
      errors: this.errorCount,
      endpoint: this.endpoint
    };
  }

  close() {
    this.socket.close();
  }
}

module.exports = ZMQPublisher;
