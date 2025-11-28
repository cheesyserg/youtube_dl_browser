# app.py - UPDATED CODE
from flask import Flask, jsonify, request, render_template
from flask_cors import CORS
from threading import Thread
import yt_dlp
import uuid
import time
import json
import os
import subprocess 
import platform
import re 
import shutil # NEW: For file deletion

app = Flask(__name__)
CORS(app) 

# --- CONFIGURATION & DATA FILES ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
QUEUE_FILE = os.path.join(BASE_DIR, 'downloads_queue.json')
CONFIG_FILE = os.path.join(BASE_DIR, 'config.json')

# --- FILENAME SANITIZATION FUNCTION (No Change) ---

def sanitize_filename(filename, replacement='_'):
    """
    Removes characters illegal on Windows/Linux from a filename string.
    Illegal characters include: < > : " / \\ | ? * and control characters.
    Also removes leading/trailing spaces and periods.
    """
    # 1. Define illegal characters (Windows specific)
    illegal_chars = r'[<>:"/\\|?*\x00-\x1F]'
    
    # 2. Replace illegal characters with the specified replacement
    cleaned_filename = re.sub(illegal_chars, replacement, filename)
    
    # 3. Remove leading/trailing spaces and periods
    cleaned_filename = cleaned_filename.strip(' .')

    # 4. Collapse multiple replacements into one (e.g., "___" becomes "_")
    cleaned_filename = re.sub(f'{replacement}{{2,}}', replacement, cleaned_filename)

    # 5. Limit length to avoid OS path limit issues (e.g., 200 chars)
    max_length = 200
    return cleaned_filename[:max_length].strip()

# --- Helper Functions for Data/Config (No Change) ---

def load_config():
    """Loads settings from config.json or returns defaults."""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                return json.load(f)
        except json.JSONDecodeError:
            print("Error reading config.json. Using default settings.")
            
    return {'DOWNLOAD_DIR': os.path.join(BASE_DIR, 'downloads')}

def save_config(config):
    """Saves settings to config.json."""
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=4)

def load_queue():
    """Loads job list from the queue file."""
    if os.path.exists(QUEUE_FILE):
        try:
            with open(QUEUE_FILE, 'r') as f:
                return json.load(f)
        except json.JSONDecodeError:
            print("Error reading downloads_queue.json. Starting with empty queue.")
            return {'jobs': []}
    return {'jobs': []}

def save_queue(jobs):
    """Saves current job list to the queue file."""
    with open(QUEUE_FILE, 'w') as f:
        json.dump({'jobs': jobs}, f, indent=4)

def init_data_store():
    """Ensures config file, queue file, and download directory exist."""
    config = load_config()
    save_config(config) 

    DOWNLOAD_DIR = config['DOWNLOAD_DIR']
    if not os.path.exists(DOWNLOAD_DIR):
        try:
            os.makedirs(DOWNLOAD_DIR)
        except OSError as e:
            print(f"Warning: Failed to create download directory {DOWNLOAD_DIR}. Error: {e}")

    if not os.path.exists(QUEUE_FILE):
        save_queue([])


# --- YT-DLP Worker Thread (No Major Change) ---

def update_job_progress(job_id, status, progress_data=None):
    jobs = load_queue()['jobs']
    for job in jobs:
        if job['id'] == job_id:
            job['status'] = status
            if progress_data:
                job['progress'] = progress_data
            save_queue(jobs)
            return

def download_worker(job_id, url, format_type):
    update_job_progress(job_id, 'running', 'Starting...')
    
    config = load_config()
    base_dir = config['DOWNLOAD_DIR']
    
    jobs = load_queue()['jobs']
    job = next((j for j in jobs if j['id'] == job_id), None)
    if not job:
        print(f"Error: Job {job_id} not found for download.")
        return

    # -------------------------------------------------------------
    # 1. FETCH METADATA AND SANITIZE TITLE BEFORE DOWNLOAD
    # -------------------------------------------------------------
    try:
        # Use info_only to get metadata without downloading
        info_opts = {'quiet': True, 'noprogress': True}
        with yt_dlp.YoutubeDL(info_opts) as ytdl:
            info = ytdl.extract_info(url, download=False)
            raw_title = info.get('title', f'unknown_video_{job_id}')
    except Exception as e:
        error_msg = f"Metadata fetch failed: {str(e)}"
        print(f"Error for job {job_id}: {error_msg}")
        update_job_progress(job_id, 'error', error_msg)
        return

    # 2. Sanitize the title
    sanitized_title = sanitize_filename(raw_title)

    # 3. Update job with the actual title and uploader now that we have it
    jobs = load_queue()['jobs']
    for j in jobs:
        if j['id'] == job_id:
            j['title'] = raw_title
            j['sanitized_title'] = sanitized_title # <-- NEW: Store sanitized title
            j['uploader'] = info.get('uploader', 'Unknown')
            break
    save_queue(jobs)
    # -------------------------------------------------------------
    
    # === Folder Structuring Logic ===
    is_audio = format_type.startswith('audio')
    if is_audio:
        sub_dir = 'Audio'
        # Determine target audio format for conversion
        target_ext = 'mp3' if format_type == 'audio_mp3' else 'opus'
        format_code = 'bestaudio' 
    else:
        sub_dir = 'Video'
        target_ext = 'mp4' # <-- Target extension for video is always MP4 after merge
        format_map = {
            'best': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
            '1080p': 'bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
            '720p': 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
            '480p': 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]',
        }
        format_code = format_map.get(format_type, format_map['best'])
        
    target_dir = os.path.join(base_dir, sub_dir)
    
    if not os.path.exists(target_dir):
        try:
            os.makedirs(target_dir)
        except Exception as e:
            print(f"Warning: Failed to create subdirectory {target_dir}. Error: {e}")
            target_dir = base_dir 
            
    # Update job with target dir and ext for post-download cleanup
    for j in jobs:
        if j['id'] == job_id:
            j['target_dir'] = target_dir
            j['target_ext'] = target_ext # <-- Store the expected extension
            break
    save_queue(jobs)

    # Configure YT-DLP options
    ydl_opts = {
        'format': format_code,
        # *** USE SANITIZED TITLE HERE ***
        'outtmpl': os.path.join(target_dir, f'{sanitized_title}.%(ext)s'), 
        'progress_hooks': [lambda d: progress_hook(job_id, d)],
        'quiet': True,
        'no_warnings': True,
        'noplaylist': True,
        'cachedir': False, 
    }
    
    # Ensure merging is set for video formats
    if not is_audio:
        ydl_opts['merge_output_format'] = 'mp4'

    # === Audio Post-processor for Conversion ===
    if is_audio:
        ydl_opts['postprocessors'] = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': target_ext, 
            'preferredquality': '192', 
        }]
        ydl_opts['keepvideo'] = False 

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([url])

    except Exception as e:
        jobs = load_queue()['jobs']
        job = next((j for j in jobs if j['id'] == job_id), None)
        if job and job.get('status') == 'stopped':
            # This is a clean stop, no need to report as error
            print(f"Job {job_id} was successfully stopped by user.")
            return # IMPORTANT: Exit cleanly after user stop
        
        error_msg = f"Download failed: {str(e)}"
        print(f"Error for job {job_id}: {error_msg}")
        update_job_progress(job_id, 'error', error_msg)

def progress_hook(job_id, d):
    jobs = load_queue()['jobs']
    job = next((j for j in jobs if j['id'] == job_id), None)
    if job and job.get('status') == 'stopped':
        # Raise an exception to stop yt_dlp from downloading further
        raise Exception("Download stopped by user.")

    if d['status'] == 'downloading':
        progress = d.get('_percent_str', 'Starting...')
        update_job_progress(job_id, 'running', progress)
    
    elif d['status'] == 'finished':
        jobs = load_queue()['jobs']
        for job in jobs:
            if job['id'] == job_id:
                # Title and uploader were fetched earlier, but update filesize
                job['filesize'] = d.get('_total_bytes_str', 'N/A')
                
                # --- FIX: Reconstruct the final path instead of trusting d['filename'] ---
                sanitized_title = job.get('sanitized_title')
                target_dir = job.get('target_dir')
                target_ext = job.get('target_ext') # Expected final extension ('mp4', 'mp3', 'opus')

                if sanitized_title and target_dir and target_ext:
                    # Construct the final expected path
                    final_path = os.path.join(target_dir, f'{sanitized_title}.{target_ext}')
                    # Normalize and store the absolute path
                    job['filepath'] = os.path.abspath(os.path.normpath(final_path))
                else:
                    job['filepath'] = 'N/A (Reconstruction failed)'
                # ---------------------------------------------
                
                break
        save_queue(jobs)
        update_job_progress(job_id, 'finished', 'Download completed successfully.')


# --- API Endpoints: Downloads Queue (MODIFIED) ---

@app.route('/')
def queue_page():
    """Serves the main downloads queue page."""
    return render_template('queue.html')

@app.route('/api/queue_job', methods=['POST'])
def queue_job():
    url = request.form.get('url')
    format_type = request.form.get('format')
    if not url or not format_type: return jsonify({'status': 'error', 'message': 'Missing URL or format'}), 400
    job_id = str(uuid.uuid4())
    
    new_job = {
        'id': job_id, 'url': url, 'format': format_type, 
        'status': 'pending', 'progress': 'Queued...',
        'title': f"Fetching title for {url[:30]}...",
        'uploader': 'N/A', 'filesize': 'N/A', 'time_queued': time.time(),
        'target_dir': 'N/A', 
        'filepath': 'N/A' ,
        'target_ext': 'N/A',
        'sanitized_title': 'N/A' # Default for new job
    }
    jobs = load_queue()['jobs']
    jobs.insert(0, new_job)
    save_queue(jobs)
    
    thread = Thread(target=download_worker, args=(job_id, url, format_type)) 
    thread.start()
    return jsonify({'status': 'queued', 'job_id': job_id})

@app.route('/api/queue', methods=['GET'])
def get_queue():
    jobs_data = load_queue()
    jobs = jobs_data['jobs']
    
    for job in jobs:
        # Check for missing file only on finished jobs that have a saved path
        if job['status'] == 'finished' and job.get('filepath') and job['filepath'] != 'N/A':
            if not os.path.exists(job['filepath']):
                job['file_missing'] = True
            else:
                job['file_missing'] = False 
        elif job['status'] == 'finished':
             job['file_missing'] = True


    return jsonify(jobs_data)

@app.route('/api/stop/<job_id>', methods=['POST'])
def stop_job(job_id):
    jobs = load_queue()['jobs']
    job_found = False
    for job in jobs:
        if job['id'] == job_id and job['status'] in ['running', 'pending']:
            job['status'] = 'stopped'
            job['progress'] = 'Stopped by user.'
            job_found = True
            break
    save_queue(jobs)
    if job_found:
        return jsonify({'status': 'success', 'message': f'Stop command sent to job {job_id}'})
    else:
        return jsonify({'status': 'error', 'message': f'Job {job_id} not found or already finished/stopped.'}), 404

# --- New Endpoint: Open File Location ---
@app.route('/api/open_file_location/<job_id>', methods=['POST'])
def open_file_location(job_id):
    jobs = load_queue()['jobs']
    job = next((j for j in jobs if j['id'] == job_id), None)
    
    if not job or job.get('filepath') == 'N/A':
        return jsonify({'status': 'error', 'message': 'Job not found or filepath is missing.'}), 404

    filepath = job['filepath']
    
    if not os.path.exists(filepath):
        return jsonify({'status': 'error', 'message': 'File not found on disk.'}), 404

    try:
        # Get the directory of the file
        file_dir = os.path.dirname(filepath)
        
        if platform.system() == "Windows":
            # Selects the file in Explorer
            subprocess.run(['explorer', '/select,', filepath], check=True)
        elif platform.system() == "Darwin": # macOS
            # Opens the containing folder and highlights the file
            subprocess.run(['open', '-R', filepath], check=True)
        else: # Linux/Other (just opens the containing folder)
            subprocess.run(['xdg-open', file_dir], check=True)
            
        return jsonify({'status': 'success', 'message': f'Opening file location for: {filepath}'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Failed to open file location: {str(e)}. Check path: {filepath}'}), 500


# --- New Endpoint: Delete Job (From Queue Only) ---
@app.route('/api/delete_job/<job_id>', methods=['DELETE'])
def delete_job(job_id):
    jobs = load_queue()['jobs']
    
    jobs_before = len(jobs)
    jobs = [job for job in jobs if job['id'] != job_id]
    jobs_after = len(jobs)
    
    if jobs_before == jobs_after:
        return jsonify({'status': 'error', 'message': f'Job {job_id} not found.'}), 404

    save_queue(jobs)
    return jsonify({'status': 'success', 'message': f'Job {job_id} removed from queue.'})


# --- New Endpoint: Delete Job and File ---
@app.route('/api/delete_job_and_file/<job_id>', methods=['DELETE'])
def delete_job_and_file(job_id):
    jobs = load_queue()['jobs']
    job = next((j for j in jobs if j['id'] == job_id), None)

    if not job:
        return jsonify({'status': 'error', 'message': f'Job {job_id} not found in queue.'}), 404

    filepath = job.get('filepath')
    file_deleted = False
    file_message = 'No file path recorded.'

    if filepath and filepath != 'N/A':
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
                file_deleted = True
                file_message = f'File deleted successfully: {filepath}'
            else:
                file_message = 'File path recorded, but file was not found on disk.'
        except Exception as e:
            file_message = f'Error deleting file {filepath}: {str(e)}'
            print(f"File deletion error for job {job_id}: {file_message}")
            return jsonify({'status': 'warning', 'message': f'Job removed from queue, but failed to delete file: {file_message}'}), 200

    # Remove job from queue
    jobs = [j for j in jobs if j['id'] != job_id]
    save_queue(jobs)
    
    return jsonify({'status': 'success', 'message': f'Job removed from queue. File status: {file_message}'})

# --- Clear Queue Endpoint (MODIFIED to support bulk action) ---
@app.route('/api/clear_queue', methods=['POST'])
def clear_queue():
    delete_files = request.json.get('delete_files', False)
    
    jobs_data = load_queue()
    current_jobs = jobs_data['jobs']
    
    # Jobs to keep: those that are running or pending
    active_jobs = [job for job in current_jobs if job['status'] in ['running', 'pending']]
    # Jobs to remove: all others
    removable_jobs = [job for job in current_jobs if job['status'] not in ['running', 'pending']]
    
    files_deleted_count = 0
    if delete_files:
        for job in removable_jobs:
            filepath = job.get('filepath')
            if filepath and filepath != 'N/A' and os.path.exists(filepath):
                try:
                    os.remove(filepath)
                    files_deleted_count += 1
                except Exception as e:
                    print(f"Bulk delete failed for file {filepath}: {e}")
                    # Continue attempting to delete others

    jobs_cleared = len(removable_jobs)
    save_queue(active_jobs)
    
    return jsonify({
        'status': 'success', 
        'message': f'Queue cleared successfully. Removed {jobs_cleared} non-active jobs. Files deleted: {files_deleted_count}.'
    })
# ---------------------------------

# --- API Endpoints: Folder Management (No Change) ---

@app.route('/api/open_folder', methods=['POST'])
def open_folder():
    """Opens the main download directory (used by the sidebar link)."""
    current_dir = load_config()['DOWNLOAD_DIR']
    
    try:
        if platform.system() == "Windows":
            os.startfile(current_dir)
        elif platform.system() == "Darwin": # macOS
            subprocess.run(['open', current_dir], check=True)
        else: # Linux/Other (uses xdg-open)
            subprocess.run(['xdg-open', current_dir], check=True)
            
        return jsonify({'status': 'success', 'message': f'Opening folder: {current_dir}'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': f'Failed to open folder: {str(e)}. Check path: {current_dir}'}), 500


# --- API Endpoints: Settings (No Change) ---

@app.route('/settings')
def settings_page():
    return render_template('settings.html')

@app.route('/api/settings', methods=['GET'])
def get_settings():
    return jsonify(load_config())

@app.route('/api/settings', methods=['POST'])
def save_settings():
    new_dir = request.json.get('DOWNLOAD_DIR')
    if not new_dir: return jsonify({'status': 'error', 'message': 'Missing DOWNLOAD_DIR'}), 400
    new_dir = os.path.abspath(new_dir).strip()
    config = load_config()
    config['DOWNLOAD_DIR'] = new_dir
    save_config(config)
    try:
        if not os.path.exists(new_dir): os.makedirs(new_dir)
        return jsonify({'status': 'success', 'message': f'Download directory updated and created: {new_dir}'})
    except Exception as e:
        return jsonify({'status': 'warning', 'message': f'Download directory updated to "{new_dir}", but failed to create folder. Check path permissions. Error: {str(e)}'}), 200

if __name__ == '__main__':
    init_data_store()
    app.run(debug=True, port=5000)