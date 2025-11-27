#!/usr/bin/env node

import inquirer from 'inquirer';
import chalk from 'chalk';
import ora from 'ora';
import boxen from 'boxen';
import { TempMail } from './tempmail.js';

const tempMail = new TempMail();

/**
 * Hiển thị banner
 */
function showBanner() {
  console.clear();
  const banner = chalk.cyan.bold(`
████████╗███████╗███╗   ███╗██████╗     ███╗   ███╗ █████╗ ██╗██╗     
╚══██╔══╝██╔════╝████╗ ████║██╔══██╗    ████╗ ████║██╔══██╗██║██║     
   ██║   █████╗  ██╔████╔██║██████╔╝    ██╔████╔██║███████║██║██║     
   ██║   ██╔══╝  ██║╚██╔╝██║██╔═══╝     ██║╚██╔╝██║██╔══██║██║██║     
   ██║   ███████╗██║ ╚═╝ ██║██║         ██║ ╚═╝ ██║██║  ██║██║███████╗
   ╚═╝   ╚══════╝╚═╝     ╚═╝╚═╝         ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝╚══════╝
  `);
  
  console.log(banner);
  console.log(chalk.yellow('  📧 Tạo email tạm thời - Nhận thư nhanh chóng\n'));
}

/**
 * Menu chính
 */
async function mainMenu() {
  const currentEmail = tempMail.getCurrentEmail();
  
  const choices = [
    { name: '📝 Tạo email tùy chỉnh', value: 'create' },
    { name: '🎲 Tạo email ngẫu nhiên', value: 'random' },
    { name: '📬 Xem hộp thư', value: 'inbox', disabled: !currentEmail },
    { name: '🔄 Làm mới hộp thư', value: 'refresh', disabled: !currentEmail },
    { name: '🌐 Đổi domain', value: 'domain' },
    { name: '📋 Danh sách email đã tạo', value: 'list' },
    { name: '🗑️  Xóa email hiện tại', value: 'delete', disabled: !currentEmail },
    { name: '❌ Thoát', value: 'exit' }
  ];

  const { action } = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: currentEmail 
        ? `Email hiện tại: ${chalk.green(currentEmail)} - Chọn hành động:`
        : 'Chọn hành động:',
      choices: choices
    }
  ]);

  return action;
}

/**
 * Tạo email tùy chỉnh
 */
async function createCustomEmail() {
  const { username } = await inquirer.prompt([
    {
      type: 'input',
      name: 'username',
      message: 'Nhập username (tên email):',
      validate: (input) => {
        if (!input || input.trim().length < 3) {
          return 'Username phải có ít nhất 3 ký tự';
        }
        if (!/^[a-z0-9._-]+$/i.test(input)) {
          return 'Username chỉ được chứa chữ cái, số, dấu chấm, gạch dưới và gạch ngang';
        }
        return true;
      }
    }
  ]);

  const spinner = ora('Đang tạo email...').start();
  
  const result = await tempMail.createEmail(username.trim());
  
  if (result.success) {
    spinner.succeed(chalk.green(result.message));
    displayEmailBox(result.email);
  } else {
    spinner.fail(chalk.red(`Lỗi: ${result.error}`));
  }

  await pause();
}

/**
 * Tạo email ngẫu nhiên
 */
async function createRandomEmail() {
  const spinner = ora('Đang tạo email ngẫu nhiên...').start();
  
  const result = await tempMail.createRandomEmail();
  
  if (result.success) {
    spinner.succeed(chalk.green(result.message));
    displayEmailBox(result.email);
  } else {
    spinner.fail(chalk.red(`Lỗi: ${result.error}`));
  }

  await pause();
}

/**
 * Xem hộp thư
 */
async function viewInbox() {
  const spinner = ora('Đang tải hộp thư...').start();
  
  const result = await tempMail.fetchMessages();
  
  if (result.success) {
    spinner.succeed(chalk.green(`Tìm thấy ${result.count} thư`));
    
    if (result.count === 0) {
      console.log(chalk.yellow('\n📭 Hộp thư trống. Đang chờ thư mới...\n'));
    } else {
      console.log(chalk.cyan.bold('\n╔══════════════════════════════════════════════════════════╗'));
      console.log(chalk.cyan.bold('║                  📬 DANH SÁCH THƯ                       ║'));
      console.log(chalk.cyan.bold('╚══════════════════════════════════════════════════════════╝\n'));
      
      result.messages.forEach((msg, index) => {
        // Header với số thứ tự
        const header = chalk.bold.white(`┌─ Thư ${index + 1}${msg.id ? ` (ID: ${msg.id})` : ''}`);
        console.log(header);
        
        // Tiêu đề
        const subject = chalk.bold.cyan(`│ 📧 ${msg.subject}`);
        console.log(subject);
        console.log(chalk.gray('├' + '─'.repeat(58)));
        
        // Người gửi
        const senderName = msg.sender_name || 'Không rõ';
        const senderEmail = msg.sender_email ? chalk.gray(` <${msg.sender_email}>`) : '';
        console.log(chalk.yellow(`│ 👤 Từ: ${senderName}`) + senderEmail);
        
        // Thời gian
        if (msg.datediff) {
          console.log(chalk.gray(`│ ⏰ ${msg.datediff}`) + (msg.date ? chalk.gray(` (${msg.date})`) : ''));
        } else if (msg.date) {
          console.log(chalk.gray(`│ ⏰ ${msg.date}`));
        }
        
        // Content preview (lấy text từ HTML, giới hạn 100 ký tự)
        if (msg.content) {
          // Remove HTML tags và lấy text
          const textContent = msg.content
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&quot;/g, '"')
            .replace(/&#039;/g, "'")
            .replace(/&amp;/g, '&')
            .trim();
          
          if (textContent) {
            const preview = textContent.length > 100 
              ? textContent.substring(0, 100) + '...' 
              : textContent;
            console.log(chalk.gray(`│ 📄 ${preview.replace(/\n/g, ' ')}`));
          }
        }
        
        // Attachments
        if (msg.attachments && msg.attachments.length > 0) {
          console.log(chalk.magenta(`│ 📎 Có ${msg.attachments.length} file đính kèm`));
        }
        
        // Footer
        console.log(chalk.gray('└' + '─'.repeat(58)));
        console.log('');
      });
      
      console.log(chalk.cyan.bold(`Tổng cộng: ${result.count} thư\n`));
    }
  } else {
    spinner.fail(chalk.red(`Lỗi: ${result.error}`));
  }

  await pause();
}

/**
 * Đổi domain
 */
async function changeDomain() {
  const domains = tempMail.getDomains();
  
  const { domain } = await inquirer.prompt([
    {
      type: 'list',
      name: 'domain',
      message: 'Chọn domain:',
      choices: domains
    }
  ]);

  const result = await tempMail.setDomain(domain);
  
  if (result.success) {
    console.log(chalk.green(`✓ Đã đổi domain thành: ${domain}`));
  } else {
    console.log(chalk.red(`✗ Lỗi: ${result.error}`));
  }

  await pause();
}

/**
 * Danh sách email đã tạo
 */
async function listEmails() {
  const emails = tempMail.getAllEmails();
  
  if (emails.length === 0) {
    console.log(chalk.yellow('\n📭 Chưa có email nào được tạo\n'));
  } else {
    console.log(chalk.cyan('\n📋 Danh sách email đã tạo:\n'));
    emails.forEach((email, index) => {
      const current = email === tempMail.getCurrentEmail();
      const prefix = current ? chalk.green('➤') : ' ';
      console.log(`${prefix} ${index + 1}. ${email}${current ? chalk.green(' (đang dùng)') : ''}`);
    });
    console.log('');
  }

  await pause();
}

/**
 * Xóa email hiện tại
 */
async function deleteCurrentEmail() {
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Bạn có chắc muốn xóa email hiện tại?',
      default: false
    }
  ]);

  if (!confirm) {
    console.log(chalk.yellow('Đã hủy'));
    await pause();
    return;
  }

  const spinner = ora('Đang xóa email...').start();
  
  const result = await tempMail.deleteEmail();
  
  if (result.success) {
    spinner.succeed(chalk.green(result.message));
  } else {
    spinner.fail(chalk.red(`Lỗi: ${result.error}`));
  }

  await pause();
}

/**
 * Hiển thị email trong box
 */
function displayEmailBox(email) {
  console.log('\n' + boxen(
    chalk.green.bold(email),
    {
      padding: 1,
      margin: 1,
      borderStyle: 'round',
      borderColor: 'green',
      title: '📧 Email của bạn',
      titleAlignment: 'center'
    }
  ));
}

/**
 * Dừng và chờ người dùng nhấn Enter
 */
async function pause() {
  await inquirer.prompt([
    {
      type: 'input',
      name: 'continue',
      message: 'Nhấn Enter để tiếp tục...'
    }
  ]);
}

/**
 * Main function
 */
async function main() {
  showBanner();
  
  const spinner = ora('Đang khởi tạo...').start();
  const initialized = await tempMail.init();
  
  if (!initialized) {
    spinner.fail(chalk.red('Không thể kết nối đến server'));
    process.exit(1);
  }
  
  spinner.succeed(chalk.green('Sẵn sàng!'));
  console.log('');

  // Main loop
  while (true) {
    const action = await mainMenu();

    switch (action) {
      case 'create':
        await createCustomEmail();
        break;
      case 'random':
        await createRandomEmail();
        break;
      case 'inbox':
      case 'refresh':
        await viewInbox();
        break;
      case 'domain':
        await changeDomain();
        break;
      case 'list':
        await listEmails();
        break;
      case 'delete':
        await deleteCurrentEmail();
        break;
      case 'exit':
        console.log(chalk.cyan('\n👋 Tạm biệt!\n'));
        process.exit(0);
    }

    showBanner();
  }
}

// Run
main().catch(error => {
  console.error(chalk.red('Lỗi:'), error.message);
  process.exit(1);
});

