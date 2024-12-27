from PIL import Image
import os

def pad_to_square(image, background_color=None):
    width, height = image.size
    max_size = max(width, height)
    
    # Determine the mode and background color
    if background_color is None:
        # For PNG and GIF (transparent background)
        mode = 'RGBA'
        background = (0, 0, 0, 0)
    else:
        # For JPG (specified background color)
        mode = 'RGB'
        background = background_color
    
    # Create a new square image with the specified background
    square_image = Image.new(mode, (max_size, max_size), background)
    
    # Calculate padding
    pad_width = (max_size - width) // 2
    pad_height = (max_size - height) // 2
    
    # Paste the original image onto the center of the square image
    square_image.paste(image, (pad_width, pad_height))
    
    return square_image

def process_gif(file_path, output_path, background_color=None):
    with Image.open(file_path) as img:
        # Extract all frames
        frames = []
        try:
            while True:
                frame = img.copy()
                if frame.mode != 'RGBA':
                    frame = frame.convert('RGBA')
                # Pad each frame to square
                squared_frame = pad_to_square(frame, background_color)
                frames.append(squared_frame)
                img.seek(len(frames))  # Move to the next frame
        except EOFError:
            pass  # End of GIF
        
        # Save the frames as a new GIF
        frames[0].save(
            output_path,
            save_all=True,
            append_images=frames[1:],
            loop=0,  # Loop forever
            duration=img.info.get('duration', 100),  # Frame duration
            transparency=0  # Preserve transparency
        )

def process_folder(folder_path, jpg_background_color=(255, 255, 255)):
    for filename in os.listdir(folder_path):
        if filename.lower().endswith(('.jpg', '.png', '.gif')):
            file_path = os.path.join(folder_path, filename)
            output_path = os.path.join(folder_path, f"padded_{filename}")
            
            # Process PNG (transparent background)
            if filename.lower().endswith('.png'):
                with Image.open(file_path) as img:
                    if img.mode != 'RGBA':
                        img = img.convert('RGBA')
                    squared_image = pad_to_square(img)
                    squared_image.save(output_path)
                    print(f"Processed and saved: {output_path}")
            
            # Process JPG (specified background color)
            elif filename.lower().endswith('.jpg'):
                with Image.open(file_path) as img:
                    if img.mode != 'RGB':
                        img = img.convert('RGB')
                    squared_image = pad_to_square(img, jpg_background_color)
                    squared_image.save(output_path)
                    print(f"Processed and saved: {output_path}")
            
            # Process GIF (transparent background)
            elif filename.lower().endswith('.gif'):
                process_gif(file_path, output_path)
                print(f"Processed and saved: {output_path}")

if __name__ == "__main__":
    folder_path = "data/logo"  # Replace with your folder path
    jpg_background_color = (255, 255, 255)  # White background for JPG
    process_folder(folder_path, jpg_background_color)