#include "multiplexer.hpp"

MultiplexerArray MuxEngine;

void MultiplexerArray::init() {
    auto setupPins = [](const MuxConfig& m) {
        pinMode(m.s0, OUTPUT);
        pinMode(m.s1, OUTPUT);
        pinMode(m.s2, OUTPUT);
        pinMode(m.s3, OUTPUT);
        if (m.enable_pin >= 0) {
            pinMode(m.enable_pin, OUTPUT);
            digitalWrite(m.enable_pin, LOW);
        }
    };
    setupPins(MUX_U4);
    setupPins(MUX_U6);
    setupPins(MUX_U7);
    setupPins(MUX_U8);
    setupPins(MUX_U10);
}

void MultiplexerArray::setChannel(const MuxConfig& mux, uint8_t channel) {
    digitalWrite(mux.s0, (channel >> 0) & 0x01);
    digitalWrite(mux.s1, (channel >> 1) & 0x01);
    digitalWrite(mux.s2, (channel >> 2) & 0x01);
    digitalWrite(mux.s3, (channel >> 3) & 0x01);
    delayMicroseconds(MUX_SETTLING_DELAY_US);
}

void MultiplexerArray::routeInputA(uint8_t input_ch, uint8_t atten_ch) {
    setChannel(MUX_U4, input_ch);
    setChannel(MUX_U6, atten_ch);
}

void MultiplexerArray::routeInputB(uint8_t input_ch, uint8_t atten_ch) {
    setChannel(MUX_U7, input_ch);
    setChannel(MUX_U8, atten_ch);
}

void MultiplexerArray::routeOutputMux(uint8_t ch) {
    setChannel(MUX_U10, ch);
}
