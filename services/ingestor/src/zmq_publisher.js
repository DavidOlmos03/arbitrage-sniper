const zmq = require('zeromq');

class ZMQPublisher {
  constructor(endpoint) {
    this.endpoint = endpoint;
    this.socket = new zmq.Push();
    this.messageCount = 0;
    this.errorCount = 0;
    this.bound = false;
  }

  async bind() {
    try {
      await this.socket.bind(this.endpoint);
      this.socket.sendHighWaterMark = 1000; // High water mark
      this.bound = true;
      console.log(`[ZMQ] Publisher bound to ${this.endpoint}`);
      return true;
    } catch (error) {
      console.error('[ZMQ] Bind error:', error.message);
      return false;
    }
  }

  async send(message) {
    if (!this.bound) {
      return false;
    }

    try {
      const serialized = JSON.stringify(message);
      await this.socket.send(serialized);
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
