#pragma once
#include "config.hpp"

class MultiplexerArray {
public:
    void init();
    void setChannel(const MuxConfig& mux, uint8_t channel);
    void routeInputA(uint8_t input_ch, uint8_t atten_ch);
    void routeInputB(uint8_t input_ch, uint8_t atten_ch);
    void routeOutputMux(uint8_t ch);
};

extern MultiplexerArray MuxEngine;
