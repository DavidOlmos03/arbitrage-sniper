const socket = io();

let signalCount = 0;
let totalProfit = 0;
let bestSpread = 0;
let bestOpportunity = '-';

// Connection status
socket.on('connect', () => {
  console.log('Connected to dashboard server');
  updateConnectionStatus(true);
  socket.emit('request_history');
});

socket.on('disconnect', () => {
  console.log('Disconnected from server');
  updateConnectionStatus(false);
});

// Receive signal history
socket.on('history', (signals) => {
  console.log('Received history:', signals.length, 'signals');
  signals.forEach(signal => addSignalToUI(signal, false));
});

// Receive live signals
socket.on('signal', (signal) => {
  console.log('New signal:', signal);
  addSignalToUI(signal, true);
  updateStats(signal);
});

function updateConnectionStatus(connected) {
  const statusEl = document.getElementById('connection-status');
  if (connected) {
    statusEl.textContent = 'Connected';
    statusEl.className = 'status-indicator connected';
  } else {
    statusEl.textContent = 'Disconnected';
    statusEl.className = 'status-indicator disconnected';
  }
}

function addSignalToUI(signal, animate = true) {
  const container = document.getElementById('signals-container');

  // Remove empty state
  const emptyState = container.querySelector('.empty-state');
  if (emptyState) {
    emptyState.remove();
  }

  // Create signal card
  const card = document.createElement('div');
  card.className = 'signal-card';
  if (signal.spread_pct > 0.5) {
    card.classList.add('profitable');
  }

  const timestamp = new Date(signal.timestamp).toLocaleTimeString();

  card.innerHTML = `
    <div class="signal-header">
      <div class="signal-action">${signal.action}</div>
      <div class="signal-time">${timestamp}</div>
    </div>
    <div class="signal-details">
      <div class="signal-detail">
        <div class="detail-label">Spread</div>
        <div class="detail-value spread">${signal.spread_pct}%</div>
      </div>
      <div class="signal-detail">
        <div class="detail-label">Buy Price</div>
        <div class="detail-value">$${signal.buy_price.toLocaleString()}</div>
      </div>
      <div class="signal-detail">
        <div class="detail-label">Sell Price</div>
        <div class="detail-value">$${signal.sell_price.toLocaleString()}</div>
      </div>
      <div class="signal-detail">
        <div class="detail-label">Estimated Profit</div>
        <div class="detail-value profit">$${signal.profit_estimate}</div>
      </div>
    </div>
  `;

  // Insert at top
  container.insertBefore(card, container.firstChild);

  // Keep only last 30 signals
  while (container.children.length > 30) {
    container.removeChild(container.lastChild);
  }

  signalCount++;
}

function updateStats(signal) {
  // Update total signals
  document.getElementById('total-signals').textContent = signalCount;

  // Update latest spread
  document.getElementById('latest-spread').textContent = `${signal.spread_pct}%`;

  // Update best opportunity
  if (signal.spread_pct > bestSpread) {
    bestSpread = signal.spread_pct;
    bestOpportunity = signal.action;
    document.getElementById('best-opportunity').textContent = `${bestSpread}%`;
  }

  // Update average profit
  totalProfit += signal.profit_estimate;
  const avgProfit = (totalProfit / signalCount).toFixed(2);
  document.getElementById('avg-profit').textContent = `$${avgProfit}`;

  // Update signal count in header
  document.getElementById('signal-count').textContent = `${signalCount} signals`;
}

function clearSignals() {
  const container = document.getElementById('signals-container');
  container.innerHTML = `
    <div class="empty-state">
      <p>Waiting for arbitrage opportunities...</p>
      <p class="help-text">Signals will appear when spread exceeds threshold</p>
    </div>
  `;

  // Reset stats
  signalCount = 0;
  totalProfit = 0;
  bestSpread = 0;
  bestOpportunity = '-';

  document.getElementById('total-signals').textContent = '0';
  document.getElementById('latest-spread').textContent = '-';
  document.getElementById('best-opportunity').textContent = '-';
  document.getElementById('avg-profit').textContent = '$0';
  document.getElementById('signal-count').textContent = '0 signals';
}

// Log connection errors
socket.on('connect_error', (error) => {
  console.error('Connection error:', error);
});
