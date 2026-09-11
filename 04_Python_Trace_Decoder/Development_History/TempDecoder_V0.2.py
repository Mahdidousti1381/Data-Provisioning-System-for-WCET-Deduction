import csv
import os
import sys
from tkinter import Tk, filedialog

class TPIUFrameDetector:
    def __init__(self, search_window=64):
        self.buffer = []
        self.search_window = search_window
        self.frame_offset = None
        self.bytes_processed = 0

    def feed_byte(self, b):
        self.bytes_processed += 1
        
        # If we haven't found the frame start yet, analyze the stream
        if self.frame_offset is None:
            self.buffer.append(b)
            if len(self.buffer) >= self.search_window:
                self.detect_alignment()

    def detect_alignment(self):
        # Look for an index 'i' where bytes at i, i+16, i+32, i+48 are all 0x7F (Sync)
        for i in range(16):
            if (self.buffer[i] == 0x7F and 
                self.buffer[i + 16] == 0x7F and 
                self.buffer[i + 32] == 0x7F and 
                self.buffer[i + 48] == 0x7F):
                
                self.frame_offset = (i + 1) % 16
                print(f"[TPIU Detector] Locked alignment! Sync pattern found at index {i}.")
                print(f"[TPIU Detector] First complete TPIU Frame begins at Byte Offset: {self.frame_offset}")
                return
        
        self.buffer = self.buffer[16:]


def process_csv(input_csv, output_bin):
    CLK_COL = 1
    D0_COL = 2
    D1_COL = 3
    D2_COL = 4
    D3_COL = 5

    prev_raw_clk = None
    potential_edge = False
    saved_nibble = 0
    bit_count = 0
    current_byte = 0

    detector = TPIUFrameDetector(search_window=64)

    with open(input_csv, 'r') as f_in, open(output_bin, 'wb') as f_out:
        reader = csv.reader(f_in)
        for row in reader:
            if not row:
                continue
                
            if 'Time' in row[0] or row[0].startswith(';'):
                continue
                
            try:
                raw_clk = int(row[CLK_COL])
                d0 = int(row[D0_COL])
                d1 = int(row[D1_COL])
                d2 = int(row[D2_COL])
                d3 = int(row[D3_COL])
            except (ValueError, IndexError):
                continue
            
            current_nibble = (d3 << 3) | (d2 << 2) | (d1 << 1) | d0

            if prev_raw_clk is None:
                prev_raw_clk = raw_clk
                continue

            if raw_clk != prev_raw_clk:
                if not potential_edge:
                    potential_edge = True
                    saved_nibble = current_nibble
                else:
                    potential_edge = False
            else:
                if potential_edge:
                    if bit_count == 0:
                        current_byte = saved_nibble
                        bit_count = 4
                    else:
                        current_byte |= (saved_nibble << 4)
                        
                        f_out.write(bytes([current_byte]))
                        detector.feed_byte(current_byte)
                        
                        bit_count = 0
                    
                    potential_edge = False 

            prev_raw_clk = raw_clk

    print(f"\nExtraction complete!")
    print(f"Input:  {os.path.basename(input_csv)}")
    print(f"Output: {os.path.basename(output_bin)}")
    
    if detector.frame_offset is not None:
        print(f"To decode with tools, your stream header sync offset is {detector.frame_offset} bytes.")
    else:
        print("Warning: Could not automatically detect TPIU frame sync alignment. Ensure trace was idling/syncing during capture.")


if __name__ == "__main__":
    # Hide the main Tkinter root window
    root = Tk()
    root.withdraw()
    
    # Force the window to appear on top of other processes
    root.attributes('-topmost', True)

    print("Opening file browser... Please select your exported logic analyzer CSV file.")
    
    # Prompt user to browse for the CSV file
    selected_file = filedialog.askopenfilename(
        title="Select Logic Analyzer Export CSV",
        filetypes=[("CSV Files", "*.csv"), ("All Files", "*.*")]
    )

    # Check if user canceled the window picker
    if not selected_file:
        print("Operation cancelled. No file selected.")
        sys.exit()

    # Generate dynamic output name based on input path
    # e.g. "path/to/capture123.csv" -> base = "path/to/capture123"
    file_base, _ = os.path.splitext(selected_file)
    output_file = f"{file_base}_extracted.bin"

    # Run processing pipeline
    process_csv(selected_file, output_file)