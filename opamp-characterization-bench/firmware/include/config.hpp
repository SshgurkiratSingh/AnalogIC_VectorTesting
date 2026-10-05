#pragma once
#include <Arduino.h>

// Multiplexer Address & Enable Lines
struct MuxConfig {
    uint8_t s0, s1, s2, s3;
    int8_t enable_pin; // -1 if tied to GND
};

// Allocation mapping to CD74HC4067 instances
constexpr MuxConfig MUX_U4  = { 2,  3,  4,  5, -1 }; // Input MUX A
constexpr MuxConfig MUX_U6  = { 6,  7,  8,  9, -1 }; // Attenuator MUX A
constexpr MuxConfig MUX_U7  = {10, 11, 12, 13, -1 }; // Input MUX B
constexpr MuxConfig MUX_U8  = {14, 15, 16, 17, -1 }; // Attenuator MUX B
constexpr MuxConfig MUX_U10 = {18, 19, 20, 21, -1 }; // Output Feedback MUX

// Settling delay accounting for 7*tau (CD74HC4067 switch + parasitic capacitance)
constexpr uint32_t MUX_SETTLING_DELAY_US = 80;

// ADS1115 Configuration
constexpr uint8_t ADS1115_I2C_ADDR = 0x48;
constexpr float ADS1115_LSB_PGA_4096 = 0.125f; // mV per count for +/-4.096V range
