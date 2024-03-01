const { GoogleSpreadsheet } = require('google-spreadsheet');
const { readFileSync } = require('fs');
require('dotenv').config();

module.exports = {
  run: async ({ interaction }) => {
    if (!interaction.guild) return; // Ensure this is a guild interaction

    try {
      // Fetch the member who initiated the interaction
      const member = await interaction.guild.members.fetch(interaction.user.id);

      // Check if the member has the 'team' role
      const hasRole = member.roles.cache.has(process.env.TEAM_ROLE_ID);

      if (!hasRole) {
        // If the member does not have the role, reply with a message and stop execution
        await interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
        return;
      }

      // Read and parse the Google service account credentials
      const creds = JSON.parse(readFileSync(process.env.GOOGLE_SHEETS_CREDENTIALS_PATH, 'utf8'));

      // Initialize JWT client for Google authentication
      const { JWT } = require('google-auth-library');
      const serviceAccountAuth = new JWT({
          email: creds.client_email,
          key: creds.private_key.replace(/\\n/g, '\n'), // Ensure newlines in private key are correctly handled
          scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      // Initialize GoogleSpreadsheet instance with the sheet ID and auth client
      const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID, serviceAccountAuth);

      await doc.loadInfo(); // Load the document properties and worksheets
      const sheet = doc.sheetsByIndex[0]; // Use the first sheet

      // Retrieve rows from the sheet
      const rows = await sheet.getRows(); // Get rows from the first sheet

      // Filter rows where the 'Completed' column is 'No'
      const filteredRows = rows.filter(row => row._rawData[6] === 'No'); // 'Completed'

      // Check if there are no rows with 'No' in the 'Completed' column
      if (filteredRows.length === 0) {
        // If there are no such rows, reply with a specific message and stop execution
        await interaction.reply({ content: 'There are no marketing requests for the time being.', ephemeral: true });
        return;
      }

      // Define the indexes of the columns to be displayed
      const displayedColumnIndexes = [0, 2, 6, 8];

      // Filter headers and calculate column widths based on the specified indexes
      let headers = sheet._headerValues.filter((_, index) => displayedColumnIndexes.includes(index));
      let columnWidths = headers.map(header => header.length);

      // Calculate maximum column widths using 'filteredRows' for the specified columns
      filteredRows.forEach(row => {
        displayedColumnIndexes.forEach((columnIndex, index) => {
          const cell = row._rawData[columnIndex] || ''; // Use an empty string if cell is undefined
          columnWidths[index] = Math.max(columnWidths[index], cell.length);
        });
      });

      // Function to pad each cell to match the column width and truncate if necessary
      const padCell = (cell, index) => {
        // Convert undefined or null to an empty string before padding
        const safeCell = cell ?? '';
        // Truncate cell content if it exceeds the maximum length for the column
        // Specifically for the "Project Name" column (assuming it's at index 0 in displayedColumnIndexes), limit the length to 15 characters
        // Also limit the separator dashes to a maximum of 20 characters
        const maxLength = index === displayedColumnIndexes.indexOf(0) ? 20 : columnWidths[index];
        const truncatedCell = safeCell.length > maxLength ? safeCell.substring(0, maxLength) : safeCell;
        return truncatedCell.padEnd(maxLength, ' ');
      };

      // Prepare the message with headers
      let message = headers.map((header, index) => padCell(header, index)).join(' | ') + '\n';
      message += columnWidths.map((width, index) => '-'.repeat(index === displayedColumnIndexes.indexOf(0) ? Math.min(20, width) : width)).join('-|-') + '\n'; // Separator line

      // Add each row of data below the headers with padding for the specified columns
      filteredRows.forEach(row => {
        const rowData = displayedColumnIndexes.map(index => row._rawData[index])
          .map((cell, index) => padCell(cell, index)).join(' | ');
        message += rowData + '\n';
      });

      // Immediately defer the reply to buy time for processing
      try {
        await interaction.deferReply({ ephemeral: true });
      } catch (err) {
        console.error('Error deferring the reply:', err);
        await interaction.followUp({ content: 'There was an error processing your request. Please try again later.', ephemeral: true });
        return;
      }

      // Split the message into chunks of 2000 characters or fewer, accounting for code block syntax
      const splitMessage = (message, maxLength = 2000 - 100) => { // Adjust for code block syntax
        const chunks = [];
        let currentChunk = ''; // Start with opening code block
        message.split('\n').forEach(line => {
          if (currentChunk.length + line.length + 4 > maxLength) { // +4 for newline and closing code block
            chunks.push(`\`\`\`\n${currentChunk}\`\`\``); // Close current chunk with code block syntax
            currentChunk = `${line}\n`; // Start new chunk
          } else {
            currentChunk += `${line}\n`;
          }
        });
        if (currentChunk) {
          chunks.push(`\`\`\`\n${currentChunk}\`\`\``); // Ensure the last chunk is closed with code block syntax
        }
        return chunks;
      };

      // Split the message into chunks of 2000 characters or fewer, accounting for code block syntax
      const messageChunks = splitMessage(message);

      // Send each chunk as a separate message using followUp
      for (const chunk of messageChunks) {
        try {
          await interaction.followUp({ content: chunk, ephemeral: true });
        } catch (err) {
          console.error('Error following up:', err);
          // If followUp fails, we already deferred, so we can't send another followUp here.
          // Consider logging the error or handling it in another way.
          break; // Exit the loop to prevent further attempts
        }
      }
    } catch (err) {
      console.error('Error retrieving data from Google Sheets:', err);
      try {
        await interaction.followUp({ content: 'There was an error retrieving the data. Please try again.', ephemeral: true });
      } catch (followUpError) {
        console.error('Error sending follow-up message:', followUpError);
        // At this point, there's not much we can do if even followUp fails.
        // Consider logging the error or handling it in another way.
      }
    }
  },

  data: {
    name: 'retrieve',
    description: 'Retrieves data from the Google Sheet and displays it in Discord!',
  },
};