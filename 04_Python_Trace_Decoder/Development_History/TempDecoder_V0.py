import csv

def process_csv(input_csv, output_bin):
    # Adjust these column indices based on your exact CSV layout
    # In your images: A=0(Time), B=1(Clk), E=4(D0), F=5(D1), G=6(D2), H=7(D3)
    CLK_COL = 1
    D0_COL = 3
    D1_COL = 4
    D2_COL = 5
    D3_COL = 6

    # --- Initialization before the loop ---
    prev_raw_clk = None
    potential_edge = False
    saved_nibble = 0
    bit_count = 0
    current_byte = 0

    with open(input_csv, 'r') as f_in, open(output_bin, 'wb') as f_out:
        reader = csv.reader(f_in)
        for row in reader:
            # Skip empty lines
            if not row:
                continue
                
            # Explicitly skip the header row and any comment rows
            if 'Time' in row[0] or row[0].startswith(';'):
                continue
                
            # Safely parse the row
            try:
                raw_clk = int(row[CLK_COL])
                d0 = int(row[D0_COL])
                d1 = int(row[D1_COL])
                d2 = int(row[D2_COL])
                d3 = int(row[D3_COL])
            except (ValueError, IndexError):
                continue
            
            # Combine current row's data into a nibble
            current_nibble = (d3 << 3) | (d2 << 2) | (d1 << 1) | d0

            # Initialize the first clock state
            if prev_raw_clk is None:
                prev_raw_clk = raw_clk
                continue

            # --- UPDATED GLITCH FILTER & SAMPLING LOGIC ---
            if raw_clk != prev_raw_clk:
                if not potential_edge:
                    # The clock just changed. It might be an edge or a 1-sample glitch.
                    # SAVE the data from this exact row, just in case it's real.
                    potential_edge = True
                    saved_nibble = current_nibble
                else:
                    # The clock changed AGAIN immediately (e.g., 0 -> 1 -> 0).
                    # This was a 1-sample glitch. Discard the potential edge.
                    potential_edge = False
            else:
                if potential_edge:
                    # The clock stayed stable after a change. The edge is confirmed!
                    # Process the data we SAVED from the exact row the edge started.
                    if bit_count == 0:
                        current_byte = saved_nibble
                        bit_count = 4
                    else:
                        current_byte |= (saved_nibble << 4)
                        f_out.write(bytes([current_byte]))
                        bit_count = 0
                    
                    # Reset the edge tracker now that we've processed it
                    potential_edge = False 

            prev_raw_clk = raw_clk

    print(f"Extraction complete! Saved to {output_bin}")

# Example usage:
process_csv('DSLogic U3Pro16-la-260601-100014.csv', 'raw_tpiu_stream5.bin')
