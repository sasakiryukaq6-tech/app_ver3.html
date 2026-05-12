class AudioProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this.bufferSize = 8192;
        this.audioBuffer = new Float32Array(this.bufferSize);
        this.bufferIndex = 0;
    }

    process(inputs) {
        const input = inputs[0];
        if (!input || input.length === 0) return true;
        const channelData = input[0];
        for (let i = 0; i < channelData.length; i++) {
            if (this.bufferIndex < this.bufferSize) {
                this.audioBuffer[this.bufferIndex++] = channelData[i];
            }
        }
        if (this.bufferIndex >= this.bufferSize) {
            this.port.postMessage(new Float32Array(this.audioBuffer));
            this.bufferIndex = 0;
        }
        return true;
    }
}
registerProcessor('audio-processor', AudioProcessor);